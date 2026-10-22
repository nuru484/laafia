import {
  CODE_FROM_STATUS, PROTOCOLS, STATUS_FROM_CODE, decode, deriveStatus, encode, normalizePhone, parse, parseDriverReply, signNames,
  type ClientType, type ClientWireType, type ReferralMessage, type ReferralStatus, type StatusMessage,
} from '@laafia/core'
import { and, asc, desc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Device } from './auth.ts'
import { db, write, type Tx } from './db.ts'
import { HttpError, log } from './http.ts'
import { devices, facilities, referral_events, referrals, transport_providers, transport_requests } from './schema.ts'
import { GATEWAY_DEVICE } from './seed.ts'
import { enqueueSms } from './sms.ts'

export type Referral = typeof referrals.$inferSelect
export type ReferralEventRow = typeof referral_events.$inferSelect
export type ReferralView = Omit<Referral, 'seq'> & { events: Omit<ReferralEventRow, 'seq'>[] }

/** In-process bus feeding /events (SSE). Emits 'referral' with a ReferralView after the write commits. */
export const bus = new EventEmitter()
bus.setMaxListeners(0)

const strip = <T extends { seq: number }>({ seq: _seq, ...rest }: T) => rest

export async function referralView(id: string): Promise<ReferralView | null> {
  const [r] = await db.select().from(referrals).where(eq(referrals.id, id))
  if (!r) return null
  const events = await db.select().from(referral_events).where(eq(referral_events.referral_id, id)).orderBy(asc(referral_events.at))
  return { ...strip(r), events: events.map(strip) }
}

/** Run a write, then publish every referral it touched. */
export async function writeAndPublish<T>(fn: (tx: Tx, touched: Set<string>) => Promise<T>): Promise<T> {
  const touched = new Set<string>()
  const out = await write((tx) => fn(tx, touched))
  for (const id of touched) {
    const view = await referralView(id)
    if (view) bus.emit('referral', view)
  }
  return out
}

/** Status is derived from the events (only moves forward); the stored column is a cache of it. */
async function recomputeStatus(tx: Tx, referralId: string) {
  const events = await tx.select({ status: referral_events.status }).from(referral_events).where(eq(referral_events.referral_id, referralId))
  const status = deriveStatus(events)
  await tx.update(referrals).set({ status }).where(and(eq(referrals.id, referralId), ne(referrals.status, status)))
  return status
}

const byKey = async (tx: Tx, origin: string, shortId: string) =>
  (await tx.select().from(referrals).where(and(eq(referrals.origin_device_id, origin), eq(referrals.short_id, shortId))))[0]
const byId = async (tx: Tx, id: string) => (await tx.select().from(referrals).where(eq(referrals.id, id)))[0]

/**
 * Who may change a referral or add its events: the origin device, the current
 * destination facility, or a facility that was an earlier hop (one of its
 * facility devices already wrote an event). The origin's own catchment is not
 * enough on its own.
 */
async function mayAct(tx: Tx, d: Device, r: Referral) {
  if (d.id === r.origin_device_id) return true
  if (!d.facility_id) return false
  if (d.facility_id === r.destination_facility_id) return true
  const [hop] = await tx.select({ id: referral_events.id }).from(referral_events)
    .innerJoin(devices, eq(devices.id, referral_events.source_device_id))
    .where(and(eq(referral_events.referral_id, r.id), eq(devices.facility_id, d.facility_id), eq(devices.role, 'facility'))).limit(1)
  return !!hop
}

/** A carried referral (QR hop) may be created by another device only with the origin's signed LFR for the same key. */
async function provesOrigin(lfr: string | null | undefined, origin: string, shortId: string) {
  if (!lfr) return false
  const keys = await activeKeys()
  const d = decode(lfr, (id) => keys.get(id))
  return d.ok && d.message.kind === 'LFR' && d.message.signer === origin && d.message.short_id === shortId
}

async function facilityOfDevice(tx: Tx, deviceId: string) {
  const [d] = await tx.select({ facility_id: devices.facility_id }).from(devices).where(eq(devices.id, deviceId))
  return d?.facility_id ?? null
}

type RejectReason = string
export type PushReferral = Omit<typeof referrals.$inferInsert, 'status' | 'seq' | 'facility_id'> & { lfr?: string | null }

/**
 * Merge a pushed referral onto the row for (origin_device_id, short_id). If the
 * server learned of it first by SMS it holds a server id; the origin phone's
 * push re-keys that row to the phone's UUID (events follow by ON UPDATE CASCADE).
 */
export async function pushReferral(tx: Tx, device: Device, pushed: PushReferral, touched: Set<string>): Promise<RejectReason | null> {
  const { lfr, ...row } = pushed
  const [idRow, keyRow] = [await byId(tx, row.id), await byKey(tx, row.origin_device_id, row.short_id)]
  if (idRow && (idRow.origin_device_id !== row.origin_device_id || idRow.short_id !== row.short_id)) return 'key_mismatch'
  let target = idRow ?? keyRow
  if (!target) {
    if (device.id !== row.origin_device_id && !(await provesOrigin(lfr, row.origin_device_id, row.short_id))) return 'forbidden'
    await tx.insert(referrals).values({ ...row, facility_id: await facilityOfDevice(tx, row.origin_device_id) ?? device.facility_id, status: 'created' })
    touched.add(row.id)
    return null
  }
  if (!(await mayAct(tx, device, target))) return 'forbidden'
  if (!idRow && device.id === row.origin_device_id) {
    await tx.update(referrals).set({ id: row.id }).where(eq(referrals.id, target.id))
    target = { ...target, id: row.id }
  }
  if (row.updated_at > target.updated_at) {
    const { id: _id, ...fields } = row
    await tx.update(referrals).set(fields).where(eq(referrals.id, target.id))
  }
  touched.add(target.id)
  return null
}

export type PushEvent = Omit<typeof referral_events.$inferInsert, 'seq'> & { origin_device_id: string; short_id: string }

/**
 * Append-only. The referral is found by id, else by (origin, short_id). An
 * unknown referral gets a stub row only when the origin device (or the server,
 * device null) writes the event; anyone else gets 'unknown_referral' and retries
 * after the referral itself has synced.
 */
export async function pushEvent(tx: Tx, device: Device | null, ev: PushEvent, touched: Set<string>): Promise<RejectReason | null> {
  const { origin_device_id, short_id, ...row } = ev
  const idRow = await byId(tx, row.referral_id)
  if (idRow && (idRow.origin_device_id !== origin_device_id || idRow.short_id !== short_id)) return 'key_mismatch'
  let target = idRow ?? (await byKey(tx, origin_device_id, short_id))
  if (!target) {
    if (device && device.id !== origin_device_id) return 'unknown_referral'
    ;[target] = await tx.insert(referrals).values({
      id: row.referral_id, origin_device_id, short_id, updated_at: 0, device_id: row.device_id,
      facility_id: await facilityOfDevice(tx, origin_device_id) ?? device?.facility_id ?? null,
    }).returning()
  } else if (device && !(await mayAct(tx, device, target))) return 'forbidden'
  await tx.insert(referral_events).values({ ...row, referral_id: target!.id }).onConflictDoNothing()
  await recomputeStatus(tx, target!.id)
  touched.add(target!.id)
  return null
}

// ---------------------------------------------------------------------------
// Gateway SMS: LFR / LFS processed exactly like a facility phone would (spec 11.5).

const WIRE_TO_TYPE: Record<ClientWireType, ClientType> = { PW: 'pregnant', PP: 'postpartum', NB: 'newborn', CH: 'child' }
const PROTOCOL_OF: Record<ClientWireType, keyof typeof PROTOCOLS> = { PW: 'maternal', PP: 'maternal', NB: 'young_infant', CH: 'child' }

async function activeKeys(): Promise<Map<string, string>> {
  const rows = await db.select({ id: devices.id, key: devices.key_hex }).from(devices).where(and(eq(devices.active, true), isNotNull(devices.key_hex)))
  return new Map(rows.map((r) => [r.id, r.key!]))
}

/** LFS from the server is signed as the destination facility's phone when it has one, else as the gateway device. */
async function signerFor(tx: Tx, destinationFacilityId: string | null) {
  const [fac] = destinationFacilityId
    ? await tx.select().from(devices).where(and(eq(devices.facility_id, destinationFacilityId), eq(devices.role, 'facility'), eq(devices.active, true), isNotNull(devices.key_hex))).limit(1)
    : []
  const [gw] = fac ? [fac] : await tx.select().from(devices).where(eq(devices.id, GATEWAY_DEVICE))
  if (!gw?.key_hex) throw new Error('no signing device: run the seed to create the gateway device')
  return gw
}

async function enqueueStatusSms(tx: Tx, r: Referral, status: ReferralStatus, to: string | null) {
  const code = CODE_FROM_STATUS[status]
  if (!code || !to) return
  const signer = await signerFor(tx, r.destination_facility_id)
  const msg: StatusMessage = { kind: 'LFS', signer: signer.id, origin: r.origin_device_id, short_id: r.short_id, status: code }
  await enqueueSms(tx, to, encode(msg, signer.key_hex!))
}

async function originPhone(tx: Tx, originDeviceId: string) {
  const [d] = await tx.select({ phone: devices.phone_number }).from(devices).where(eq(devices.id, originDeviceId))
  return d?.phone ?? null
}

export type InboundResult =
  | { ok: true; kind: 'referral'; referral_id: string; duplicate: boolean }
  | { ok: true; kind: 'status'; referral_id: string; status: ReferralStatus }
  | { ok: true; kind: 'driver_reply'; transport_request_id: string; status: 'coming' | 'declined' }
  | { ok: false; error: 'not_laafia' | 'unknown_signer' | 'bad_signature' | 'conflict' }

function sameReferral(r: Referral, m: ReferralMessage, destinationId: string | null) {
  return r.client_code === m.client_code && r.urgency === m.urgency && r.client_type === WIRE_TO_TYPE[m.client_type] && r.destination_facility_id === destinationId
}

async function onReferral(m: ReferralMessage, from: string): Promise<InboundResult> {
  return writeAndPublish(async (tx, touched) => {
    const [dest] = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, m.destination))
    const destinationId = dest?.id ?? null
    let r = await byKey(tx, m.signer, m.short_id)
    // Stub rows (learned from an LFS before the LFR) have no client yet; anything else must match (spec 11.4 replay rule).
    if (r && r.client_code !== null && !sameReferral(r, m, destinationId)) {
      log('warn', 'sms_referral_conflict', { origin: m.signer, short_id: m.short_id })
      return { ok: false, error: 'conflict' } as const
    }
    const duplicate = !!r && r.client_code !== null
    const fields = {
      client_code: m.client_code, client_type: WIRE_TO_TYPE[m.client_type], context: m.context === '-' ? null : m.context, urgency: m.urgency,
      danger_signs: signNames(PROTOCOLS[PROTOCOL_OF[m.client_type]], m.sign_codes), destination_facility_id: destinationId, next_of_kin: m.next_of_kin,
    }
    if (!r) {
      // updated_at 0: the origin phone's push always wins LWW and fills client_id / visit_id.
      ;[r] = await tx.insert(referrals).values({
        id: randomUUID(), origin_device_id: m.signer, short_id: m.short_id, updated_at: 0, device_id: GATEWAY_DEVICE,
        facility_id: await facilityOfDevice(tx, m.signer), delivered_via: 'sms', ...fields,
      }).returning()
    } else if (!duplicate) {
      ;[r] = await tx.update(referrals).set({ ...fields, delivered_via: r.delivered_via ?? 'sms' }).where(eq(referrals.id, r.id)).returning()
    }
    await pushEvent(tx, null, {
      id: `gw-${m.signer}-${m.short_id}-received`, referral_id: r!.id, origin_device_id: m.signer, short_id: m.short_id,
      status: 'received', at: Date.now(), updated_at: Date.now(), source_device_id: GATEWAY_DEVICE, via: 'sms', device_id: GATEWAY_DEVICE,
    }, touched)
    // Acknowledge to the sender every time: a resend usually means the first ack was lost.
    await enqueueStatusSms(tx, r!, 'received', from)
    return { ok: true, kind: 'referral', referral_id: r!.id, duplicate } as const
  })
}

async function onStatus(m: StatusMessage): Promise<InboundResult> {
  const status = STATUS_FROM_CODE[m.status]
  return writeAndPublish(async (tx, touched) => {
    const existing = await byKey(tx, m.origin, m.short_id)
    const referral_id = existing?.id ?? randomUUID()
    await pushEvent(tx, null, {
      id: `sms-${m.signer}-${m.origin}-${m.short_id}-${m.status}`, referral_id, origin_device_id: m.origin, short_id: m.short_id,
      status, at: Date.now(), updated_at: Date.now(), source_device_id: m.signer, via: 'sms', device_id: GATEWAY_DEVICE,
    }, touched)
    return { ok: true, kind: 'status', referral_id, status } as const
  })
}

async function onDriverReply(from: string, body: string): Promise<InboundResult | null> {
  const reply = parseDriverReply(body)
  if (!reply) return null
  return write(async (tx) => {
    const [req] = await tx.select({ id: transport_requests.id }).from(transport_requests)
      .innerJoin(transport_providers, eq(transport_providers.id, transport_requests.provider_id))
      .where(and(eq(transport_providers.phone, normalizePhone(from)), eq(transport_requests.status, 'requested')))
      .orderBy(desc(transport_requests.updated_at)).limit(1)
    if (!req) return null
    await tx.update(transport_requests).set({ status: reply, updated_at: Date.now(), device_id: GATEWAY_DEVICE }).where(eq(transport_requests.id, req.id))
    return { ok: true, kind: 'driver_reply', transport_request_id: req.id, status: reply } as const
  })
}

export async function handleInboundSms(from: string, body: string): Promise<InboundResult> {
  if (!parse(body)) return (await onDriverReply(from, body)) ?? { ok: false, error: 'not_laafia' }
  const keys = await activeKeys()
  const d = decode(body, (id) => keys.get(id))
  if (!d.ok) {
    log('warn', 'sms_rejected', { error: d.error })
    return d
  }
  return d.message.kind === 'LFR' ? onReferral(d.message, normalizePhone(from)) : onStatus(d.message)
}

// ---------------------------------------------------------------------------
// Web inbox

export const WEB_STATUSES = ['received', 'arrived', 'treated', 'closed', 'cancelled'] as const

/** Status button on the web inbox or a facility device: writes the event and texts LFS to the origin CHO. */
export async function setStatus(id: string, status: (typeof WEB_STATUSES)[number], device: Device | null) {
  await writeAndPublish(async (tx, touched) => {
    const r = await byId(tx, id)
    if (!r || (device && !(await mayAct(tx, device, r)))) throw new HttpError(404, 'not_found', 'Referral not found')
    const now = Date.now()
    const source = device?.id ?? 'WEB'
    await pushEvent(tx, null, {
      id: randomUUID(), referral_id: r.id, origin_device_id: r.origin_device_id, short_id: r.short_id,
      status, at: now, updated_at: now, source_device_id: source, via: 'https', device_id: source,
    }, touched)
    await enqueueStatusSms(tx, r, status, await originPhone(tx, r.origin_device_id))
  })
  return (await referralView(id))!
}

export async function facilityByCode(code: string) {
  const [f] = await db.select().from(facilities).where(eq(facilities.code, code))
  if (!f) throw new HttpError(404, 'not_found', 'Unknown facility code')
  return f
}

/** Inbox listing for a facility: referrals to it or from its catchment, open ones first. */
export async function listReferrals(facilityId: string) {
  const rows = await db.select().from(referrals)
    .where(and(eq(referrals.deleted, false), or(eq(referrals.destination_facility_id, facilityId), eq(referrals.facility_id, facilityId))))
    .orderBy(desc(referrals.urgency), desc(referrals.seq)).limit(200)
  const events = rows.length ? await db.select().from(referral_events).where(inArray(referral_events.referral_id, rows.map((r) => r.id))).orderBy(asc(referral_events.at)) : []
  return rows.map((r): ReferralView => ({ ...strip(r), events: events.filter((e) => e.referral_id === r.id).map(strip) }))
}

export const visibleTo = (facilityId: string, v: Pick<Referral, 'facility_id' | 'destination_facility_id'>) =>
  v.facility_id === facilityId || v.destination_facility_id === facilityId
