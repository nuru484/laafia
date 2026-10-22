import {
  CODE_FROM_STATUS,
  PROTOCOLS,
  STATUS_FROM_CODE,
  WIRE_TYPE,
  decode,
  deriveStatus,
  encode,
  normalizePhone,
  parse,
  parseDriverReply,
  shortIdFromBytes,
  signCodes,
  transportRequestText,
  type ClientType,
  type ClientWireType,
  type Evaluation,
  type ReferralStatus,
  type Seed,
} from '@laafia/core'
import type { Db } from './db/db'

/*
 * The referral relay (spec 11 to 15): build and sign referrals, queue SMS,
 * process everything that arrives by SMS or QR, and apply radio results. Pure
 * over the Db interface, so the same code is tested on node:sqlite.
 */

export type Role = 'cho' | 'volunteer' | 'facility'
export type Self = { device_id: string; role: Role; key_hex: string; phone: string }
export type Env = { db: Db; self: Self; now: () => number; uuid: () => string; random: (n: number) => Uint8Array }

export type Incoming = { sender: string; body: string; received_at: number; via: 'sms' | 'qr' }
export type IncomingResult =
  | { kind: 'referral'; referral_id: string; isNew: boolean }
  | { kind: 'status'; referral_id: string | null; status: ReferralStatus }
  | { kind: 'driver'; request_id: string; status: 'coming' | 'declined' }
  | { kind: 'rejected'; error: string }
  | { kind: 'ignored' }
  | { kind: 'duplicate' }

export type SendResult = { id: string; status: 'sent' | 'failed' | 'delivered'; error: string | null; at: number }

export type OutboxRow = {
  id: string; kind: string; recipient: string; body: string; ref_table: string | null; ref_id: string | null
  status: string; attempts: number; sim_index: number; next_attempt_at: number
}

export type ReferralRow = {
  id: string; origin_device_id: string; short_id: string; client_id: string | null; client_code: string
  client_type: string; context: string; urgency: number; sign_codes: string; destination_code: string
  next_of_kin: string | null; visit_id: string | null; wire: string; created_at: number; parent_referral_id?: string | null
}

const MIN = 60_000
/** Generic failures back off; waiting for signal does not use up attempts. */
const BACKOFF_MS = [30_000, 2 * MIN, 10 * MIN, 60 * MIN]
const MAX_ATTEMPTS = 8
const NO_SIGNAL = new Set(['no_service', 'radio_off'])
const RETRY_NO_SIGNAL_MS = MIN
const STUCK_SENDING_MS = 15 * MIN
const REACK_AFTER_MS = 2 * MIN
const DAY = 86_400_000
const PICKUP_NOTICE_MS = 18 * 60 * MIN

const sync = (env: Env) => [env.now(), env.self.device_id] as const

export async function loadSeed(env: Env, seed: Seed): Promise<void> {
  const { db } = env
  const t = env.now()
  await db.tx(async () => {
    for (const f of seed.facilities) {
      await db.run('INSERT OR REPLACE INTO facilities (id, code, name, level, phone, lat, lng, capabilities) VALUES (?,?,?,?,?,?,?,?)',
        [f.id, f.code, f.name, f.level, f.phone, f.lat, f.lng, JSON.stringify(f.capabilities)])
    }
    for (const d of seed.devices) {
      await db.run('INSERT OR REPLACE INTO devices (id, role, user_name, phone_number, facility_code, key_hex, active) VALUES (?,?,?,?,?,?,1)',
        [d.id, d.role, d.user_name, d.phone_number, d.facility_code, d.key_hex])
    }
    for (const h of seed.households) {
      await db.run('INSERT OR REPLACE INTO households (id, community, head_name, landmark, lat, lng, consent_at, updated_at, device_id, synced) VALUES (?,?,?,?,?,?,?,?,?,1)',
        [h.id, h.community, h.head_name, h.landmark, h.lat, h.lng, h.consent_at, t, 'seed'])
    }
    for (const c of seed.clients) {
      await db.run(
        'INSERT OR REPLACE INTO clients (id, household_id, code, type, name, sex, dob, edd, delivery_date, parity, prior_complications, birth_weight_g, nhis_active, updated_at, device_id, synced) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
        [c.id, c.household_id, c.code, c.type, c.name, c.sex, c.dob, c.edd, c.delivery_date, c.parity, JSON.stringify(c.prior_complications), c.birth_weight_g, c.nhis_active ? 1 : 0, t, 'seed'])
    }
    for (const v of seed.visits) {
      await db.run(
        'INSERT OR REPLACE INTO visits (id, client_id, protocol_id, protocol_version, visited_at, answers, outcome, rule_id, followup_due, muac_mm, updated_at, device_id, synced) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,1)',
        [v.id, v.client_id, v.protocol_id, v.visited_at, JSON.stringify(v.answers), v.outcome, v.rule_id, v.followup_due, v.muac_mm, t, 'seed'])
    }
    for (const p of seed.transport_providers) {
      await db.run('INSERT OR REPLACE INTO transport_providers (id, name, phone, vehicle, community, active, updated_at, device_id, synced) VALUES (?,?,?,?,?,1,?,?,1)',
        [p.id, p.name, p.phone, p.vehicle, p.community, t, 'seed'])
    }
  })
}

async function addEvent(env: Env, referralId: string, status: ReferralStatus, source: string, via: string): Promise<boolean> {
  const r = await env.db.run(
    'INSERT OR IGNORE INTO referral_events (id, referral_id, status, at, source_device_id, via, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?)',
    [env.uuid(), referralId, status, env.now(), source, via, ...sync(env)],
  )
  return r.changes > 0
}

export async function referralStatus(env: Env, referralId: string): Promise<ReferralStatus> {
  return deriveStatus(await env.db.all<{ status: ReferralStatus }>('SELECT status FROM referral_events WHERE referral_id = ?', [referralId]))
}

async function enqueueSms(env: Env, recipient: string, body: string, refTable: string | null, refId: string | null, notBefore?: number): Promise<string> {
  const id = env.uuid()
  await env.db.run(
    "INSERT INTO outbox (id, kind, recipient, body, ref_table, ref_id, status, next_attempt_at, created_at) VALUES (?, 'sms', ?, ?, ?, ?, 'pending', ?, ?)",
    [id, normalizePhone(recipient), body, refTable, refId, Math.max(env.now(), notBefore ?? 0), env.now()],
  )
  return id
}

function wireContext(type: ClientType, c: { dob: number | null; edd: number | null; delivery_date: number | null }, now: number): string {
  const days = (ms: number) => Math.max(0, Math.floor(ms / DAY))
  if (type === 'pregnant' && c.edd !== null) return `GA${Math.min(45, Math.max(1, Math.floor((280 - days(c.edd - now)) / 7)))}`
  if (type === 'postpartum' && c.delivery_date !== null) return `PP${Math.min(999, days(now - c.delivery_date))}`
  if (type === 'newborn' && c.dob !== null) return `PP${Math.min(999, days(now - c.dob))}`
  if (c.dob !== null) return `AGE${Math.min(99, Math.floor(days(now - c.dob) / 30))}M`
  return '-'
}

export type NewReferral = {
  client_id: string
  visit_id: string | null
  protocol_id: keyof typeof PROTOCOLS
  evaluation: Evaluation
  destination_code: string
}

export async function createReferral(env: Env, input: NewReferral): Promise<{ referral: ReferralRow; wire: string }> {
  const { db } = env
  if (input.evaluation.outcome !== 'refer') throw new Error('createReferral needs a refer outcome')
  const client = await db.get<{ id: string; code: string; type: ClientType; dob: number | null; edd: number | null; delivery_date: number | null; next_of_kin: string | null }>(
    'SELECT id, code, type, dob, edd, delivery_date, next_of_kin FROM clients WHERE id = ?', [input.client_id])
  if (!client) throw new Error(`unknown client ${input.client_id}`)
  const facility = await db.get<{ code: string; phone: string | null }>('SELECT code, phone FROM facilities WHERE code = ?', [input.destination_code])
  if (!facility) throw new Error(`unknown facility ${input.destination_code}`)

  const codes = signCodes(PROTOCOLS[input.protocol_id], input.evaluation.danger_signs)
  return db.tx(async () => {
    const shortId = await freshShortId(env)
    const nok = client.next_of_kin ? normalizePhone(client.next_of_kin) : null
    const wire = encode({
      kind: 'LFR', signer: env.self.device_id, short_id: shortId, client_code: client.code,
      urgency: input.evaluation.urgency as 1 | 2 | 3, client_type: WIRE_TYPE[client.type],
      context: wireContext(client.type, client, env.now()), sign_codes: codes, destination: facility.code,
      next_of_kin: nok && /^0\d{9}$/.test(nok) ? nok : null,
    }, env.self.key_hex)
    const referral: ReferralRow = {
      id: env.uuid(), origin_device_id: env.self.device_id, short_id: shortId, client_id: client.id, client_code: client.code,
      client_type: WIRE_TYPE[client.type], context: wireContext(client.type, client, env.now()), urgency: input.evaluation.urgency,
      sign_codes: JSON.stringify(codes), destination_code: facility.code, next_of_kin: nok, visit_id: input.visit_id, wire, created_at: env.now(),
    }
    await insertReferral(env, referral)
    await addEvent(env, referral.id, 'created', env.self.device_id, 'local')
    if (facility.phone) await enqueueSms(env, facility.phone, wire, 'referrals', referral.id)
    return { referral, wire }
  })
}

async function insertReferral(env: Env, r: ReferralRow) {
  await env.db.run(
    'INSERT INTO referrals (id, origin_device_id, short_id, client_id, client_code, client_type, context, urgency, sign_codes, destination_code, next_of_kin, visit_id, wire, created_at, parent_referral_id, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [r.id, r.origin_device_id, r.short_id, r.client_id, r.client_code, r.client_type, r.context, r.urgency, r.sign_codes, r.destination_code, r.next_of_kin, r.visit_id, r.wire, r.created_at, r.parent_referral_id ?? null, ...sync(env)],
  )
}

async function freshShortId(env: Env): Promise<string> {
  let shortId = shortIdFromBytes(env.random(5))
  while (await env.db.get('SELECT 1 FROM referrals WHERE origin_device_id = ? AND short_id = ?', [env.self.device_id, shortId])) {
    shortId = shortIdFromBytes(env.random(5))
  }
  return shortId
}

/**
 * A facility sends a received patient on to a higher level (spec 12.3). The
 * new referral is signed by this facility, carries the same assessment, and
 * links to the referral it came from.
 */
export async function referOnward(env: Env, parentId: string, destinationCode: string): Promise<ReferralRow> {
  const { db } = env
  const parent = await db.get<ReferralRow>('SELECT * FROM referrals WHERE id = ?', [parentId])
  if (!parent) throw new Error(`unknown referral ${parentId}`)
  const facility = await db.get<{ code: string; phone: string | null }>('SELECT code, phone FROM facilities WHERE code = ?', [destinationCode])
  if (!facility) throw new Error(`unknown facility ${destinationCode}`)
  return db.tx(async () => {
    const shortId = await freshShortId(env)
    const wire = encode({
      kind: 'LFR', signer: env.self.device_id, short_id: shortId, client_code: parent.client_code, urgency: parent.urgency as 1 | 2 | 3,
      client_type: parent.client_type as ClientWireType, context: parent.context, sign_codes: JSON.parse(parent.sign_codes), destination: facility.code,
      next_of_kin: parent.next_of_kin && /^0\d{9}$/.test(parent.next_of_kin) ? parent.next_of_kin : null,
    }, env.self.key_hex)
    const referral: ReferralRow = { ...parent, id: env.uuid(), origin_device_id: env.self.device_id, short_id: shortId, destination_code: facility.code, wire, created_at: env.now(), parent_referral_id: parent.id, visit_id: null }
    await insertReferral(env, referral)
    await addEvent(env, referral.id, 'created', env.self.device_id, 'local')
    if (facility.phone) await enqueueSms(env, facility.phone, wire, 'referrals', referral.id)
    return referral
  })
}

async function keyDirectory(db: Db): Promise<Map<string, string>> {
  const rows = await db.all<{ id: string; key_hex: string }>('SELECT id, key_hex FROM devices WHERE active = 1 AND key_hex IS NOT NULL')
  return new Map(rows.map((r) => [r.id, r.key_hex]))
}

async function acknowledge(env: Env, referral: ReferralRow, status: 'R' | 'A' | 'T' | 'C', fallbackRecipient: string | null) {
  const origin = await env.db.get<{ phone_number: string }>('SELECT phone_number FROM devices WHERE id = ?', [referral.origin_device_id])
  const to = origin?.phone_number ?? fallbackRecipient
  if (!to || to === 'qr') return
  const body = encode({ kind: 'LFS', signer: env.self.device_id, origin: referral.origin_device_id, short_id: referral.short_id, status }, env.self.key_hex)
  await enqueueSms(env, to, body, 'acks', referral.id)
}

export async function processIncoming(env: Env, raw: Incoming): Promise<IncomingResult> {
  const { db } = env
  return db.tx(async () => {
    const inboxId = env.uuid()
    const stored = await db.run('INSERT OR IGNORE INTO inbox (id, sender, body, received_at, via) VALUES (?,?,?,?,?)', [inboxId, raw.sender, raw.body, raw.received_at, raw.via])
    if (stored.changes === 0) return { kind: 'duplicate' } as const
    const result = await handle(env, raw)
    await db.run('UPDATE inbox SET result = ? WHERE id = ?', [JSON.stringify(result), inboxId])
    return result
  })
}

async function handle(env: Env, raw: Incoming): Promise<IncomingResult> {
  const { db } = env
  const keys = await keyDirectory(db)
  const verified = decode(raw.body, (id) => keys.get(id))
  // A carrier without the signer's key (volunteers hold none) may still carry a scanned
  // referral; the facility verifies it. A bad signature against a known key is refused.
  const carriedUnverified = !verified.ok && verified.error === 'unknown_signer' && raw.via === 'qr' && env.self.role !== 'facility'
  const message = verified.ok ? verified.message : carriedUnverified ? parse(raw.body)?.message : undefined

  if (!message || (message.kind === 'LFS' && !verified.ok)) {
    if (!verified.ok && verified.error !== 'not_laafia') return { kind: 'rejected', error: verified.error }
    const reply = parseDriverReply(raw.body)
    if (!reply || raw.via !== 'sms') return { kind: 'ignored' }
    const request = await db.get<{ id: string }>(
      "SELECT r.id FROM transport_requests r JOIN transport_providers p ON p.id = r.provider_id WHERE p.phone = ? AND r.status = 'requested' ORDER BY r.requested_at DESC LIMIT 1",
      [normalizePhone(raw.sender)])
    if (!request) return { kind: 'ignored' }
    await db.run('UPDATE transport_requests SET status = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?', [reply, ...sync(env), request.id])
    return { kind: 'driver', request_id: request.id, status: reply }
  }

  const m = message
  if (m.kind === 'LFS') {
    // Only facilities move a referral forward; any other key holder signing an LFS is refused.
    const signer = await db.get<{ role: string }>('SELECT role FROM devices WHERE id = ?', [m.signer])
    if (signer?.role !== 'facility') return { kind: 'rejected', error: 'not_a_facility' }
    const ref = await db.get<{ id: string }>('SELECT id FROM referrals WHERE origin_device_id = ? AND short_id = ?', [m.origin, m.short_id])
    const status = STATUS_FROM_CODE[m.status]
    if (ref) {
      const isNew = await addEvent(env, ref.id, status, m.signer, raw.via)
      // Discharge closes the loop: the client comes back on the origin CHO's list (spec 14).
      if (isNew && status === 'closed' && m.origin === env.self.device_id) await scheduleFollowUpAfterClose(env, ref.id)
    }
    return { kind: 'status', referral_id: ref?.id ?? null, status }
  }

  const existing = await db.get<ReferralRow>('SELECT * FROM referrals WHERE origin_device_id = ? AND short_id = ?', [m.signer, m.short_id])
  const facilityMode = env.self.role === 'facility'
  if (existing) {
    if (facilityMode) {
      await addEvent(env, existing.id, 'received', env.self.device_id, raw.via)
      // The CHO resends when our acknowledgement did not reach her; answer again, but not for every copy.
      const lastAck = await db.get<{ created_at: number }>("SELECT max(created_at) AS created_at FROM outbox WHERE ref_table = 'acks' AND ref_id = ?", [existing.id])
      if (!lastAck?.created_at || env.now() - lastAck.created_at >= REACK_AFTER_MS) await acknowledge(env, existing, 'R', raw.sender)
    }
    return { kind: 'referral', referral_id: existing.id, isNew: false }
  }

  const client = await db.get<{ id: string }>('SELECT id FROM clients WHERE code = ?', [m.client_code])
  const referral: ReferralRow = {
    id: env.uuid(), origin_device_id: m.signer, short_id: m.short_id, client_id: client?.id ?? null, client_code: m.client_code,
    client_type: m.client_type, context: m.context, urgency: m.urgency, sign_codes: JSON.stringify(m.sign_codes),
    destination_code: m.destination, next_of_kin: m.next_of_kin, visit_id: null, wire: raw.body.trim(), created_at: env.now(),
  }
  await insertReferral(env, referral)
  if (facilityMode) {
    await addEvent(env, referral.id, 'received', env.self.device_id, raw.via)
    await acknowledge(env, referral, 'R', raw.sender)
  } else {
    // Carried by hand: hold a copy and forward it, signature untouched, when this phone has signal.
    await addEvent(env, referral.id, 'carrying', env.self.device_id, raw.via)
    const dest = await db.get<{ phone: string | null }>('SELECT phone FROM facilities WHERE code = ?', [m.destination])
    if (dest?.phone) await enqueueSms(env, dest.phone, referral.wire, 'referrals', referral.id)
  }
  return { kind: 'referral', referral_id: referral.id, isNew: true }
}

/** No acknowledgement: send the identical signed text again, to the facility or a backup number. */
export async function resendReferral(env: Env, referralId: string, recipient?: string): Promise<void> {
  const r = await env.db.get<{ wire: string; destination_code: string }>('SELECT wire, destination_code FROM referrals WHERE id = ?', [referralId])
  if (!r?.wire) throw new Error('This referral has no signed text on this phone to resend')
  const to = recipient ?? (await env.db.get<{ phone: string | null }>('SELECT phone FROM facilities WHERE code = ?', [r.destination_code]))?.phone
  if (!to) throw new Error('No phone number for the destination facility')
  await enqueueSms(env, to, r.wire, 'referrals', referralId)
}

const FOLLOW_UP_AFTER_CLOSE_DAYS = 3

async function scheduleFollowUpAfterClose(env: Env, referralId: string) {
  const r = await env.db.get<{ client_id: string | null; client_type: string }>('SELECT client_id, client_type FROM referrals WHERE id = ?', [referralId])
  if (!r?.client_id) return
  const protocol = r.client_type === 'NB' ? 'young_infant' : r.client_type === 'CH' ? 'child' : 'maternal'
  await env.db.run(
    "INSERT INTO visits (id, client_id, protocol_id, protocol_version, visited_at, answers, outcome, rule_id, followup_due, updated_at, device_id) VALUES (?, ?, ?, ?, ?, '{}', 'followup', 'REFERRAL-CLOSED', ?, ?, ?)",
    [env.uuid(), r.client_id, protocol, PROTOCOLS[protocol].version, env.now(), env.now() + FOLLOW_UP_AFTER_CLOSE_DAYS * DAY, ...sync(env)])
}

/** Facility buttons: arrived, treated, closed. Each is an event and a signed SMS back to the CHO. */
export async function facilityUpdate(env: Env, referralId: string, status: 'arrived' | 'treated' | 'closed'): Promise<void> {
  const referral = await env.db.get<ReferralRow>('SELECT * FROM referrals WHERE id = ?', [referralId])
  if (!referral) throw new Error(`unknown referral ${referralId}`)
  await env.db.tx(async () => {
    if (await addEvent(env, referralId, status, env.self.device_id, 'local')) {
      await acknowledge(env, referral, CODE_FROM_STATUS[status] as 'A' | 'T' | 'C', null)
    }
  })
}

export async function dueMessages(env: Env): Promise<OutboxRow[]> {
  return env.db.all<OutboxRow>(
    "SELECT * FROM outbox WHERE (status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND sending_since <= ?) ORDER BY created_at",
    [env.now(), env.now() - STUCK_SENDING_MS],
  )
}

export async function markSending(env: Env, id: string, simIndex: number): Promise<void> {
  await env.db.run("UPDATE outbox SET status = 'sending', sending_since = ?, sim_index = ? WHERE id = ?", [env.now(), simIndex, id])
}

export async function applySendResult(env: Env, r: SendResult): Promise<void> {
  const { db } = env
  await db.tx(async () => {
    const row = await db.get<OutboxRow>('SELECT * FROM outbox WHERE id = ?', [r.id])
    if (!row) return
    if (r.status === 'delivered') {
      await db.run("UPDATE outbox SET status = 'delivered' WHERE id = ?", [r.id])
      return
    }
    if (r.status === 'sent') {
      if (row.status === 'delivered') return
      await db.run("UPDATE outbox SET status = 'sent', last_error = NULL WHERE id = ?", [r.id])
      if (row.ref_table === 'referrals' && row.ref_id) await addEvent(env, row.ref_id, 'sent', env.self.device_id, 'sms')
      return
    }
    // A late failure for a part never downgrades a message already sent or delivered.
    if (row.status !== 'sending' && row.status !== 'pending') return
    if (r.error && NO_SIGNAL.has(r.error)) {
      await db.run("UPDATE outbox SET status = 'pending', last_error = ?, next_attempt_at = ?, sim_index = ? WHERE id = ?",
        [r.error, env.now() + RETRY_NO_SIGNAL_MS, (row.sim_index + 1) % 2, r.id])
      return
    }
    const attempts = row.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    await db.run('UPDATE outbox SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?',
      [failed ? 'failed' : 'pending', attempts, r.error, env.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!, r.id])
  })
}

type Trip = { short_id: string; urgency: number; destination: string; landmark: string | null; lat: number | null; lng: number | null; client_id: string | null }

/** Emergency pickup for a referral, or a planned trip for a follow-up visit to this CHO's compound. */
export async function requestTransport(env: Env, input: { referral_id?: string | null; client_id?: string | null; provider_id: string; scheduled_for?: number | null }): Promise<string> {
  const { db } = env
  let r: Trip | undefined
  if (input.referral_id) {
    r = await db.get<Trip>(
      `SELECT r.short_id, r.urgency, f.name AS destination, h.landmark, h.lat, h.lng, r.client_id
         FROM referrals r JOIN facilities f ON f.code = r.destination_code
         LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN households h ON h.id = c.household_id
        WHERE r.id = ?`, [input.referral_id])
    if (!r) throw new Error(`unknown referral ${input.referral_id}`)
  } else if (input.client_id) {
    r = await db.get<Trip>(
      `SELECT c.code AS short_id, 0 AS urgency, f.name AS destination, h.landmark, h.lat, h.lng, c.id AS client_id
         FROM clients c JOIN households h ON h.id = c.household_id
         JOIN devices d ON d.id = ? JOIN facilities f ON f.code = d.facility_code
        WHERE c.id = ?`, [env.self.device_id, input.client_id])
    if (!r) throw new Error(`unknown client ${input.client_id}`)
  } else {
    throw new Error('A pickup needs a referral or a client')
  }
  const provider = await db.get<{ phone: string }>('SELECT phone FROM transport_providers WHERE id = ? AND active = 1', [input.provider_id])
  if (!provider) throw new Error(`unknown transport provider ${input.provider_id}`)
  const id = env.uuid()
  await db.tx(async () => {
    await db.run('INSERT INTO transport_requests (id, referral_id, client_id, provider_id, status, scheduled_for, requested_at, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, input.referral_id ?? null, r.client_id, input.provider_id, 'requested', input.scheduled_for ?? null, env.now(), ...sync(env)])
    const text = transportRequestText({
      urgent: r.urgency >= 2, pickup: r.landmark ?? 'Ask the CHO for the house', destination_name: r.destination,
      cho_phone: env.self.phone, short_id: r.short_id, lat: r.lat, lng: r.lng,
    })
    // A planned trip is texted the day before (spec 15), so the driver can plan; an emergency goes now.
    const sendAt = input.scheduled_for ? input.scheduled_for - PICKUP_NOTICE_MS : undefined
    await enqueueSms(env, provider.phone, text, 'transport_requests', id, sendAt)
  })
  return id
}
