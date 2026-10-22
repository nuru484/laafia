import { CODE_FROM_STATUS, decode, deriveStatus, encode, type ReferralStatus, type StatusMessage } from '@laafia/core'
import type { Referral as ReferralRow, ReferralEvent as EventRow } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { write, type Tx } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { fromWire, toWire } from '../../platform/http/wire.ts'
import { enqueueSms } from '../../platform/jobs/worker.ts'
import type { Device } from '../../platform/middleware/auth.ts'

export const GATEWAY_DEVICE = 'GW01'

type Num<T, K extends keyof T> = Omit<T, K> & { [P in K]: number }
export type Referral = Num<ReferralRow, 'updatedAt' | 'seq'>
export type ReferralEvent = Num<EventRow, 'updatedAt' | 'seq' | 'at'>
/** Wire shape (docs/API.md): a referrals row in snake_case plus its events ordered by `at`. */
export type ReferralView = Record<string, unknown> & { id: string; facility_id: string | null; destination_facility_id: string | null; status: string; events: Record<string, unknown>[] }

export const viewOf = (r: Referral, events: ReferralEvent[]): ReferralView =>
  ({ ...toWire(r), events: events.map((e) => toWire(e)) }) as ReferralView

export async function referralView(deps: Deps, id: string): Promise<ReferralView | null> {
  const r = await deps.prisma.referral.findUnique({ where: { id }, include: { events: { orderBy: { at: 'asc' } } } })
  if (!r) return null
  const { events, ...row } = r
  return viewOf(row, events)
}

/** Run a write, then publish every referral it touched on the SSE bus. */
export async function writeAndPublish<T>(deps: Deps, fn: (tx: Tx, touched: Set<string>) => Promise<T>): Promise<T> {
  const touched = new Set<string>()
  const out = await write(deps.prisma, (tx) => fn(tx, touched))
  for (const id of touched) {
    const view = await referralView(deps, id)
    if (view) deps.bus.emit('referral', view)
  }
  return out
}

/** Status is derived from the events (only moves forward); the stored column is a cache of it. */
async function recomputeStatus(tx: Tx, referralId: string) {
  const events = await tx.referralEvent.findMany({ where: { referralId }, select: { status: true } })
  const status = deriveStatus(events as { status: ReferralStatus }[])
  await tx.referral.updateMany({ where: { id: referralId, status: { not: status } }, data: { status } })
  return status
}

export const byKey = (tx: Tx, originDeviceId: string, shortId: string) =>
  tx.referral.findUnique({ where: { originDeviceId_shortId: { originDeviceId, shortId } } })
export const byId = (tx: Tx, id: string) => tx.referral.findUnique({ where: { id } })

/**
 * Who may change a referral or add its events: the origin device, the current
 * destination facility, or a facility that was an earlier hop (one of its
 * facility devices already wrote an event). The origin's own catchment is not
 * enough on its own.
 */
export async function mayAct(tx: Tx, d: Pick<Device, 'id' | 'facilityId'>, r: Pick<Referral, 'id' | 'originDeviceId' | 'destinationFacilityId'>) {
  if (d.id === r.originDeviceId) return true
  if (!d.facilityId) return false
  if (d.facilityId === r.destinationFacilityId) return true
  const facilityDevices = await tx.device.findMany({ where: { facilityId: d.facilityId, role: 'facility' }, select: { id: true } })
  const hop = await tx.referralEvent.findFirst({ where: { referralId: r.id, sourceDeviceId: { in: facilityDevices.map((x) => x.id) } }, select: { id: true } })
  return !!hop
}

export async function activeKeys(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx.device.findMany({ where: { active: true, keyHex: { not: null } }, select: { id: true, keyHex: true } })
  return new Map(rows.map((r) => [r.id, r.keyHex!]))
}

/** A carried referral (QR hop) may be created by another device only with the origin's signed LFR for the same key. */
async function provesOrigin(tx: Tx, lfr: string | null | undefined, origin: string, shortId: string) {
  if (!lfr) return false
  const keys = await activeKeys(tx)
  const d = decode(lfr, (id) => keys.get(id))
  return d.ok && d.message.kind === 'LFR' && d.message.signer === origin && d.message.short_id === shortId
}

export async function facilityOfDevice(tx: Tx, deviceId: string) {
  const d = await tx.device.findUnique({ where: { id: deviceId }, select: { facilityId: true } })
  return d?.facilityId ?? null
}

type RejectReason = string
/** A validated referrals sync row (snake_case wire keys, see sync.schemas.ts). */
export type PushReferral = { id: string; origin_device_id: string; short_id: string; updated_at: number; lfr?: string | null } & Record<string, unknown>

/**
 * Merge a pushed referral onto the row for (origin_device_id, short_id). If the
 * server learned of it first by SMS it holds a server id; the origin phone's
 * push re-keys that row to the phone's UUID (events follow by ON UPDATE CASCADE).
 */
export async function pushReferral(tx: Tx, device: Device, pushed: PushReferral, touched: Set<string>): Promise<RejectReason | null> {
  const { lfr, ...wire } = pushed
  const row = fromWire(wire) as Omit<Referral, 'seq' | 'status' | 'facilityId'>
  const [idRow, keyRow] = [await byId(tx, row.id), await byKey(tx, row.originDeviceId, row.shortId)]
  if (idRow && (idRow.originDeviceId !== row.originDeviceId || idRow.shortId !== row.shortId)) return 'key_mismatch'
  let target = idRow ?? keyRow
  if (!target) {
    if (device.id !== row.originDeviceId && !(await provesOrigin(tx, lfr, row.originDeviceId, row.shortId))) return 'forbidden'
    const created = await tx.referral.create({ data: { ...row, dangerSigns: row.dangerSigns ?? [], facilityId: (await facilityOfDevice(tx, row.originDeviceId)) ?? device.facilityId, status: 'created' } })
    touched.add(row.id)
    // Reached the facility by HTTPS: if no phone there is in facility mode, the server acknowledges for it.
    const origin = await tx.device.findUnique({ where: { id: created.originDeviceId }, select: { phoneNumber: true } })
    await acknowledgeIfNoFacilityPhone(tx, Date.now(), created, origin?.phoneNumber ?? null, touched, 'https')
    return null
  }
  if (!(await mayAct(tx, device, target))) return 'forbidden'
  if (!idRow && device.id === row.originDeviceId) {
    target = await tx.referral.update({ where: { id: target.id }, data: { id: row.id } })
  }
  if (row.updatedAt > target.updatedAt) {
    const { id: _id, ...fields } = row
    await tx.referral.update({ where: { id: target.id }, data: { ...fields, dangerSigns: fields.dangerSigns ?? [] } })
  }
  touched.add(target.id)
  return null
}

/** A referral_events row (wire keys) plus the referral's key, so it can be found under any id. */
export type PushEvent = {
  id: string; referral_id: string; origin_device_id: string; short_id: string; status: string; at: number
  updated_at: number; source_device_id: string; via: string; device_id?: string | null; deleted?: boolean
}

/**
 * Append-only. The referral is found by id, else by (origin, short_id). An
 * unknown referral gets a stub row only when the origin device (or the server)
 * writes the event; anyone else gets 'unknown_referral' and retries after the
 * referral itself has synced. `device` is the writer whose authority applies;
 * null only for events the server generates itself (gateway ack, web status button).
 */
export async function pushEvent(tx: Tx, device: Device | null, ev: PushEvent, touched: Set<string>): Promise<RejectReason | null> {
  const { origin_device_id: originDeviceId, short_id: shortId, ...wire } = ev
  const row = fromWire(wire) as { id: string; referralId: string; status: string; at: number; updatedAt: number; sourceDeviceId: string; via: string; deviceId?: string | null; deleted?: boolean }
  const idRow = await byId(tx, row.referralId)
  if (idRow && (idRow.originDeviceId !== originDeviceId || idRow.shortId !== shortId)) return 'key_mismatch'
  let target = idRow ?? (await byKey(tx, originDeviceId, shortId))
  if (!target) {
    if (device && device.id !== originDeviceId) return 'unknown_referral'
    target = await tx.referral.create({
      data: {
        id: row.referralId, originDeviceId, shortId, updatedAt: 0, deviceId: row.deviceId ?? null,
        facilityId: (await facilityOfDevice(tx, originDeviceId)) ?? device?.facilityId ?? null,
      },
    })
  } else if (device && !(await mayAct(tx, device, target))) return 'forbidden'
  await tx.referralEvent.createMany({ data: [{ ...row, referralId: target.id }], skipDuplicates: true })
  await recomputeStatus(tx, target.id)
  touched.add(target.id)
  return null
}

/** LFS from the server is signed as the destination facility's phone when it has one, else as the gateway device. */
async function signerFor(tx: Tx, destinationFacilityId: string | null) {
  const fac = destinationFacilityId
    ? await tx.device.findFirst({ where: { facilityId: destinationFacilityId, role: 'facility', active: true, keyHex: { not: null } } })
    : null
  const signer = fac ?? (await tx.device.findUnique({ where: { id: GATEWAY_DEVICE } }))
  if (!signer?.keyHex) throw new Error('no signing device: run the seed to create the gateway device')
  return signer
}

export async function enqueueStatusSms(tx: Tx, now: number, r: Pick<Referral, 'originDeviceId' | 'shortId' | 'destinationFacilityId'>, status: ReferralStatus, to: string | null) {
  const code = CODE_FROM_STATUS[status]
  if (!code || !to) return
  const signer = await signerFor(tx, r.destinationFacilityId)
  const msg: StatusMessage = { kind: 'LFS', signer: signer.id, origin: r.originDeviceId, short_id: r.shortId, status: code }
  await enqueueSms(tx, now, to, encode(msg, signer.keyHex!))
}

/** True when the facility has an active device in facility mode, which acknowledges referrals itself. */
export async function hasFacilityPhone(tx: Tx, facilityId: string | null) {
  if (!facilityId) return false
  return !!(await tx.device.findFirst({ where: { facilityId, role: 'facility', active: true }, select: { id: true } }))
}

/**
 * The server SMS gateway is the fallback path: it acknowledges a referral (received event plus
 * LFS R to the sender) only when the destination has no phone in facility mode to do it.
 * Returns whether it acknowledged.
 */
export async function acknowledgeIfNoFacilityPhone(tx: Tx, now: number, r: Pick<Referral, 'id' | 'originDeviceId' | 'shortId' | 'destinationFacilityId'>, to: string | null, touched: Set<string>, via: 'sms' | 'https') {
  if (!r.destinationFacilityId || (await hasFacilityPhone(tx, r.destinationFacilityId))) return false
  await pushEvent(tx, null, {
    id: `gw-${r.originDeviceId}-${r.shortId}-received`, referral_id: r.id, origin_device_id: r.originDeviceId, short_id: r.shortId,
    status: 'received', at: now, updated_at: now, source_device_id: GATEWAY_DEVICE, via, device_id: GATEWAY_DEVICE,
  }, touched)
  await enqueueStatusSms(tx, now, r, 'received', to)
  return true
}

// --- Web inbox and facility devices

export const WEB_STATUSES = ['received', 'arrived', 'treated', 'closed', 'cancelled'] as const

/** Status button on the web inbox or a facility device: writes the event and texts LFS to the origin CHO. */
export async function setStatus(deps: Deps, id: string, status: (typeof WEB_STATUSES)[number], device: Device | null) {
  await writeAndPublish(deps, async (tx, touched) => {
    const r = await byId(tx, id)
    if (!r || (device && !(await mayAct(tx, device, r)))) throw new HttpError(404, 'not_found', 'Referral not found')
    const now = deps.clock()
    const source = device?.id ?? 'WEB'
    await pushEvent(tx, null, {
      id: randomUUID(), referral_id: r.id, origin_device_id: r.originDeviceId, short_id: r.shortId,
      status, at: now, updated_at: now, source_device_id: source, via: 'https', device_id: source,
    }, touched)
    const origin = await tx.device.findUnique({ where: { id: r.originDeviceId }, select: { phoneNumber: true } })
    await enqueueStatusSms(tx, now, r, status, origin?.phoneNumber ?? null)
  })
  return (await referralView(deps, id))!
}

export async function facilityByCode(deps: Deps, code: string) {
  const f = await deps.prisma.facility.findUnique({ where: { code } })
  if (!f) throw new HttpError(404, 'not_found', 'Unknown facility code')
  return f
}

/** Inbox listing for a facility: referrals to it or from its catchment, open ones first. */
export async function listReferrals(deps: Deps, facilityId: string) {
  const rows = await deps.prisma.referral.findMany({
    where: { deleted: false, OR: [{ destinationFacilityId: facilityId }, { facilityId }] },
    orderBy: [{ urgency: { sort: 'desc', nulls: 'first' } }, { seq: 'desc' }], // Postgres default for DESC: NULLs first
    take: 200,
    include: { events: { orderBy: { at: 'asc' } } },
  })
  return rows.map(({ events, ...r }) => viewOf(r, events))
}

/** A facility device may only act for its own facility; the admin token may act for any. */
export async function facilityFor(deps: Deps, device: Device | null, code: string) {
  const f = await facilityByCode(deps, code)
  if (device && device.facilityId !== f.id) throw new HttpError(403, 'forbidden', 'Not your facility')
  return f
}

export const visibleTo = (facilityId: string, v: Pick<ReferralView, 'facility_id' | 'destination_facility_id'>) =>
  v.facility_id === facilityId || v.destination_facility_id === facilityId
