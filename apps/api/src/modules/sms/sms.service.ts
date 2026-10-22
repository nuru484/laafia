import {
  PROTOCOLS, STATUS_FROM_CODE, decode, normalizePhone, parse, parseDriverReply, signNames,
  type ClientType, type ClientWireType, type ReferralMessage, type ReferralStatus, type StatusMessage,
} from '@laafia/core'
import { randomUUID } from 'node:crypto'
import { write } from '../../platform/db.ts'
import { jobIdOfMsgId } from '../../platform/jobs/worker.ts'
import { FrogReceipt } from './sms.schemas.ts'
import type { Deps } from '../../platform/deps.ts'
import {
  GATEWAY_DEVICE, acknowledgeIfNoFacilityPhone, activeKeys, byKey, facilityOfDevice, mayAct, pushEvent, writeAndPublish, type Referral,
} from '../referrals/index.ts'

/* Gateway SMS: LFR / LFS processed exactly like a facility phone would (spec 11.5). */

const WIRE_TO_TYPE: Record<ClientWireType, ClientType> = { PW: 'pregnant', PP: 'postpartum', NB: 'newborn', CH: 'child' }
const PROTOCOL_OF: Record<ClientWireType, keyof typeof PROTOCOLS> = { PW: 'maternal', PP: 'maternal', NB: 'young_infant', CH: 'child' }

export type InboundResult =
  | { ok: true; kind: 'referral'; referral_id: string; duplicate: boolean }
  | { ok: true; kind: 'status'; referral_id: string; status: ReferralStatus }
  | { ok: true; kind: 'driver_reply'; transport_request_id: string; status: 'coming' | 'declined' }
  | { ok: false; error: 'not_laafia' | 'unknown_signer' | 'bad_signature' | 'conflict' | 'forbidden' }

function sameReferral(r: Referral, m: ReferralMessage, destinationId: string | null) {
  return r.clientCode === m.client_code && r.urgency === m.urgency && r.clientType === WIRE_TO_TYPE[m.client_type] && r.destinationFacilityId === destinationId
}

async function onReferral(deps: Deps, m: ReferralMessage, from: string): Promise<InboundResult> {
  return writeAndPublish(deps, async (tx, touched) => {
    const now = deps.clock()
    const dest = await tx.facility.findUnique({ where: { code: m.destination }, select: { id: true } })
    const destinationId = dest?.id ?? null
    let r = await byKey(tx, m.signer, m.short_id)
    // Stub rows (learned from an event before the LFR) have no client yet; anything else must match (spec 11.4 replay rule).
    if (r && r.clientCode !== null && !sameReferral(r, m, destinationId)) {
      deps.logger.warn('sms_referral_conflict', { origin: m.signer, short_id: m.short_id })
      return { ok: false, error: 'conflict' } as const
    }
    const duplicate = !!r && r.clientCode !== null
    const fields = {
      clientCode: m.client_code, clientType: WIRE_TO_TYPE[m.client_type], context: m.context === '-' ? null : m.context, urgency: m.urgency,
      dangerSigns: signNames(PROTOCOLS[PROTOCOL_OF[m.client_type]], m.sign_codes), destinationFacilityId: destinationId, nextOfKin: m.next_of_kin,
    }
    if (!r) {
      // updatedAt 0: the origin phone's push always wins LWW and fills client_id / visit_id.
      r = await tx.referral.create({
        data: {
          id: randomUUID(), originDeviceId: m.signer, shortId: m.short_id, updatedAt: 0, deviceId: GATEWAY_DEVICE,
          facilityId: await facilityOfDevice(tx, m.signer), deliveredVia: 'sms', ...fields,
        },
      })
    } else if (!duplicate) {
      r = await tx.referral.update({ where: { id: r.id }, data: { ...fields, deliveredVia: r.deliveredVia ?? 'sms' } })
    }
    touched.add(r.id)
    // Acknowledge for a facility with no phone in facility mode, every time: a resend usually means the first ack was lost.
    await acknowledgeIfNoFacilityPhone(tx, now, r, from, touched, 'sms')
    return { ok: true, kind: 'referral', referral_id: r.id, duplicate } as const
  })
}

/**
 * An LFS carries the signer's authority only: the signer must be an active
 * device allowed to act on the referral (origin, destination or earlier hop).
 * No stubs: an LFS for a referral the server has not seen is refused.
 */
async function onStatus(deps: Deps, m: StatusMessage): Promise<InboundResult> {
  const status = STATUS_FROM_CODE[m.status]
  return writeAndPublish(deps, async (tx, touched) => {
    const now = deps.clock()
    const signer = await tx.device.findFirst({ where: { id: m.signer, active: true } })
    const existing = await byKey(tx, m.origin, m.short_id)
    const reason = !signer || !existing || !(await mayAct(tx, signer, existing))
      ? 'forbidden'
      : await pushEvent(tx, signer, {
        id: `sms-${m.signer}-${m.origin}-${m.short_id}-${m.status}`, referral_id: existing.id, origin_device_id: m.origin, short_id: m.short_id,
        status, at: now, updated_at: now, source_device_id: m.signer, via: 'sms', device_id: GATEWAY_DEVICE,
      }, touched)
    if (reason) {
      deps.logger.warn('sms_status_forbidden', { signer: m.signer })
      return { ok: false, error: 'forbidden' } as const
    }
    return { ok: true, kind: 'status', referral_id: existing!.id, status } as const
  })
}

async function onDriverReply(deps: Deps, from: string, body: string): Promise<InboundResult | null> {
  const reply = parseDriverReply(body)
  if (!reply) return null
  return write(deps.prisma, async (tx) => {
    const providers = await tx.transportProvider.findMany({ where: { phone: normalizePhone(from) }, select: { id: true } })
    const req = await tx.transportRequest.findFirst({
      where: { providerId: { in: providers.map((p) => p.id) }, status: 'requested' }, orderBy: { updatedAt: 'desc' }, select: { id: true },
    })
    if (!req) return null
    await tx.transportRequest.update({ where: { id: req.id }, data: { status: reply, updatedAt: deps.clock(), deviceId: GATEWAY_DEVICE } })
    return { ok: true, kind: 'driver_reply', transport_request_id: req.id, status: reply } as const
  })
}

const DELIVERY: Record<string, 'delivered' | 'failed' | 'pending'> = {
  DELIVRD: 'delivered', ANSWERED: 'delivered', ACCEPTD: 'pending', WAITING: 'pending', BUSY: 'pending',
  UNDELIV: 'failed', REJECTD: 'failed', FAILED: 'failed', EXPIRED: 'failed', DELETED: 'failed', UNKNOWN: 'failed',
}

/** Apply Frog delivery receipts to their jobs. Malformed or unknown receipts are skipped, never fatal. */
export async function applyDeliveryReceipts(deps: Deps, items: unknown[]) {
  let applied = 0
  for (const raw of items) {
    const parsed = FrogReceipt.safeParse(raw)
    const jobId = parsed.success ? jobIdOfMsgId(parsed.data.msgid) : null
    if (!parsed.success || jobId === null) {
      deps.logger.warn('sms_receipt_skipped', { reason: parsed.success ? 'unknown_msgid' : 'invalid' })
      continue
    }
    const status = DELIVERY[parsed.data.status]!
    const res = await deps.prisma.job.updateMany({
      where: { id: jobId },
      data: { deliveryStatus: status, deliveryReason: parsed.data.reason ?? null, deliveredAt: status === 'delivered' ? deps.clock() : null },
    })
    applied += res.count
  }
  if (items.length) deps.logger.info('sms_receipts', { received: items.length, applied })
  return { received: items.length, applied }
}

export async function handleInboundSms(deps: Deps, from: string, body: string): Promise<InboundResult> {
  if (!parse(body)) return (await onDriverReply(deps, from, body)) ?? { ok: false, error: 'not_laafia' }
  const keys = await activeKeys(deps.prisma)
  const d = decode(body, (id) => keys.get(id))
  if (!d.ok) {
    deps.logger.warn('sms_rejected', { error: d.error })
    return d
  }
  return d.message.kind === 'LFR' ? onReferral(deps, d.message, normalizePhone(from)) : onStatus(deps, d.message)
}
