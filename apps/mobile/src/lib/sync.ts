import { PROTOCOLS, type ClientWireType } from '@laafia/core'
import type { Db, Param } from './db/db'
import type { Env } from './relay'

/*
 * HTTPS sync (docs/API.md: /sync/push and /sync/pull). The phone keeps wire
 * codes and facility codes; the server keeps sign names and facility ids, so
 * referrals and their events are translated both ways here.
 */

export interface Api {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any>
}

type Row = Record<string, unknown>
type Rejected = { id: string; table: string; reason: string }

const BATCH = 200
const MAX_PER_RUN = 2000
const PAGE = 500
/** Rejections worth retrying; anything else is permanent and parked as synced = -1. */
const RETRYABLE = new Set(['unknown_referral', 'server_error'])

/** Plain synced tables: local column -> how it travels. */
const PLAIN: Record<string, { cols: string[]; json?: string[]; bool?: string[] }> = {
  households: { cols: ['id', 'community', 'head_name', 'landmark', 'lat', 'lng', 'consent_at'] },
  clients: {
    cols: ['id', 'household_id', 'code', 'type', 'name', 'sex', 'dob', 'edd', 'delivery_date', 'parity', 'prior_complications', 'birth_weight_g', 'nhis_active'],
    json: ['prior_complications'],
    bool: ['nhis_active'],
  },
  visits: { cols: ['id', 'client_id', 'protocol_id', 'visited_at', 'answers', 'outcome', 'rule_id', 'followup_due', 'notes', 'muac_mm'], json: ['answers'] },
  transport_providers: { cols: ['id', 'name', 'phone', 'vehicle', 'community', 'active'], bool: ['active'] },
  transport_requests: { cols: ['id', 'referral_id', 'provider_id', 'status', 'scheduled_for'] },
}
const PUSH_ORDER = ['households', 'clients', 'visits', 'referrals', 'referral_events', 'transport_providers', 'transport_requests']

const FULL_TYPE: Record<ClientWireType, string> = { PW: 'pregnant', PP: 'postpartum', NB: 'newborn', CH: 'child' }
const WIRE_OF: Record<string, ClientWireType> = { pregnant: 'PW', postpartum: 'PP', newborn: 'NB', child: 'CH' }
const PRIMARY: Record<ClientWireType, keyof typeof PROTOCOLS> = { PW: 'maternal', PP: 'maternal', NB: 'young_infant', CH: 'child' }

/** Codes are unique within a protocol; a child under two months uses the young infant table, so fall back across protocols. */
function protocolsFor(type: ClientWireType) {
  const first = PROTOCOLS[PRIMARY[type]]
  return [first, ...Object.values(PROTOCOLS).filter((p) => p !== first)]
}
function namesFromCodes(type: ClientWireType, codes: string[]): string[] {
  return codes.map((code) => {
    for (const p of protocolsFor(type)) for (const [name, s] of Object.entries(p.signs)) if (s.code === code) return name
    return code
  })
}
function codesFromNames(type: ClientWireType, names: string[]): string[] {
  return names.map((name) => protocolsFor(type).find((p) => p.signs[name])?.signs[name]?.code ?? name)
}

function toWire(table: string, local: Row): Row {
  const spec = PLAIN[table]!
  const out: Row = { updated_at: local.updated_at, device_id: local.device_id, deleted: local.deleted === 1 }
  for (const c of spec.cols) {
    let v = local[c]
    if (spec.json?.includes(c)) v = JSON.parse((v as string) ?? 'null')
    if (spec.bool?.includes(c)) v = v === 1
    out[c] = v ?? null
  }
  return out
}

async function referralToWire(env: Env, r: Row): Promise<Row> {
  const facility = await env.db.get<{ id: string }>('SELECT id FROM facilities WHERE code = ?', [r.destination_code as string])
  const type = r.client_type as ClientWireType
  const out: Row = {
    id: r.id, origin_device_id: r.origin_device_id, short_id: r.short_id, client_id: r.client_id, visit_id: r.visit_id,
    client_code: r.client_code, client_type: FULL_TYPE[type], context: r.context, urgency: r.urgency,
    danger_signs: namesFromCodes(type, JSON.parse(r.sign_codes as string)), destination_facility_id: facility?.id ?? null,
    next_of_kin: r.next_of_kin, updated_at: r.updated_at, device_id: r.device_id, deleted: r.deleted === 1,
  }
  // The server only accepts a referral from a non-origin device with the origin's signed text.
  if (r.origin_device_id !== env.self.device_id && r.wire) out.lfr = r.wire
  return out
}

export async function push(env: Env, api: Api): Promise<{ accepted: number; rejected: number }> {
  const { db } = env
  const records: { table: string; row: Row }[] = []
  for (const table of PUSH_ORDER) {
    if (records.length >= MAX_PER_RUN) break
    const limit = MAX_PER_RUN - records.length
    if (table === 'referrals') {
      for (const r of await db.all<Row>('SELECT * FROM referrals WHERE synced = 0 LIMIT ?', [limit])) records.push({ table, row: await referralToWire(env, r) })
    } else if (table === 'referral_events') {
      const rows = await db.all<Row>(
        'SELECT e.*, r.origin_device_id, r.short_id FROM referral_events e JOIN referrals r ON r.id = e.referral_id WHERE e.synced = 0 LIMIT ?', [limit])
      for (const e of rows) {
        records.push({ table, row: {
          id: e.id, referral_id: e.referral_id, origin_device_id: e.origin_device_id, short_id: e.short_id, status: e.status,
          at: e.at, source_device_id: e.source_device_id, via: e.via, updated_at: e.updated_at, device_id: e.device_id, deleted: e.deleted === 1,
        } })
      }
    } else {
      for (const r of await db.all<Row>(`SELECT * FROM ${table} WHERE synced = 0 LIMIT ?`, [limit])) records.push({ table, row: toWire(table, r) })
    }
  }

  let accepted = 0
  let rejected = 0
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    const res = (await api.request('POST', '/sync/push', { device_id: env.self.device_id, records: batch })) as { accepted: string[]; rejected: Rejected[] }
    const tableOf = new Map(batch.map((b) => [b.row.id as string, b.table]))
    await db.tx(async () => {
      for (const id of res.accepted) {
        const table = tableOf.get(id)
        if (table) await db.run(`UPDATE ${table} SET synced = 1 WHERE id = ?`, [id])
      }
      for (const r of res.rejected) {
        const table = tableOf.get(r.id)
        if (table && !RETRYABLE.has(r.reason)) await db.run(`UPDATE ${table} SET synced = -1 WHERE id = ?`, [r.id])
      }
    })
    accepted += res.accepted.length
    rejected += res.rejected.length
  }
  return { accepted, rejected }
}

/** Last writer wins, except that an unsynced local edit at least as new as the pulled row is kept. */
async function localWins(db: Db, table: string, id: string, updatedAt: number): Promise<boolean> {
  const local = await db.get<{ updated_at: number; synced: number }>(`SELECT updated_at, synced FROM ${table} WHERE id = ?`, [id])
  return !!local && local.synced !== 1 && local.updated_at >= updatedAt
}

async function upsert(db: Db, table: string, values: Row) {
  const cols = Object.keys(values)
  await db.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
    cols.map((c) => values[c] as Param),
  )
}

async function applyPulled(env: Env, table: string, row: Row) {
  const { db } = env
  const id = row.id as string
  const updatedAt = Number(row.updated_at ?? 0)
  const meta = { updated_at: updatedAt, device_id: (row.device_id as string | null) ?? 'server', synced: 1, deleted: row.deleted ? 1 : 0 }

  if (table === 'facilities') {
    await upsert(db, 'facilities', { id, code: row.code, name: row.name, level: row.level, phone: row.phone ?? null, lat: row.lat, lng: row.lng, capabilities: JSON.stringify(row.capabilities ?? []) })
    return
  }
  if (table === 'devices') {
    const facility = row.facility_id ? await db.get<{ code: string }>('SELECT code FROM facilities WHERE id = ?', [row.facility_id as string]) : undefined
    // Keys never travel in device rows; keep whatever the key directory set.
    await db.run(
      `INSERT INTO devices (id, role, user_name, phone_number, facility_code, active) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET role = excluded.role, user_name = excluded.user_name, phone_number = excluded.phone_number, facility_code = excluded.facility_code, active = excluded.active`,
      [id, row.role as string, row.user_name as string, (row.phone_number as string) ?? '', facility?.code ?? null, row.active === false ? 0 : 1])
    return
  }
  if (table === 'referrals') {
    const type = WIRE_OF[row.client_type as string] ?? 'CH'
    const existing = await db.get<{ id: string }>('SELECT id FROM referrals WHERE origin_device_id = ? AND short_id = ?', [row.origin_device_id as string, row.short_id as string])
    if (existing && existing.id !== id) {
      // The server knows this referral under the canonical id; move the local row and everything pointing at it.
      await db.run('UPDATE referrals SET id = ? WHERE id = ?', [id, existing.id])
      await db.run('UPDATE referral_events SET referral_id = ? WHERE referral_id = ?', [id, existing.id])
      await db.run('UPDATE transport_requests SET referral_id = ? WHERE referral_id = ?', [id, existing.id])
      await db.run('UPDATE outbox SET ref_id = ? WHERE ref_id = ?', [id, existing.id])
    }
    if (await localWins(db, 'referrals', id, updatedAt)) return
    const facility = row.destination_facility_id ? await db.get<{ code: string }>('SELECT code FROM facilities WHERE id = ?', [row.destination_facility_id as string]) : undefined
    const wire = (await db.get<{ wire: string }>('SELECT wire FROM referrals WHERE id = ?', [id]))?.wire ?? ''
    await upsert(db, 'referrals', {
      id, origin_device_id: row.origin_device_id, short_id: row.short_id, client_id: row.client_id ?? null, client_code: row.client_code ?? '',
      client_type: type, context: row.context ?? '-', urgency: row.urgency ?? 1,
      sign_codes: JSON.stringify(codesFromNames(type, (row.danger_signs as string[]) ?? [])), destination_code: facility?.code ?? '',
      next_of_kin: row.next_of_kin ?? null, visit_id: row.visit_id ?? null, wire, created_at: (await db.get<{ created_at: number }>('SELECT created_at FROM referrals WHERE id = ?', [id]))?.created_at ?? updatedAt,
      ...meta,
    })
    return
  }
  if (table === 'referral_events') {
    await db.run(
      'INSERT OR IGNORE INTO referral_events (id, referral_id, status, at, source_device_id, via, updated_at, device_id, synced, deleted) VALUES (?,?,?,?,?,?,?,?,1,?)',
      [id, row.referral_id as string, row.status as string, row.at as number, row.source_device_id as string, row.via as string, updatedAt, meta.device_id, meta.deleted])
    return
  }
  const spec = PLAIN[table]
  if (!spec) return
  if (await localWins(db, table, id, updatedAt)) return
  const values: Row = { ...meta }
  for (const c of spec.cols) {
    let v = row[c] ?? null
    if (spec.json?.includes(c)) v = JSON.stringify(v ?? (c === 'answers' ? {} : []))
    if (spec.bool?.includes(c)) v = v ? 1 : 0
    values[c] = v
  }
  if (table === 'visits') values.protocol_version = (await db.get<{ protocol_version: number }>('SELECT protocol_version FROM visits WHERE id = ?', [id]))?.protocol_version ?? 1
  if (table === 'transport_requests') values.requested_at = (await db.get<{ requested_at: number }>('SELECT requested_at FROM transport_requests WHERE id = ?', [id]))?.requested_at ?? updatedAt
  await upsert(db, table, values)
}

export async function pull(env: Env, api: Api): Promise<{ records: number }> {
  const { db } = env
  let total = 0
  for (;;) {
    const cursor = (await db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'sync_cursor'"))?.value
    const query = new URLSearchParams({ limit: String(PAGE) })
    if (cursor) query.set('since', cursor)
    const page = (await api.request('GET', `/sync/pull?${query}`)) as { records: { table: string; row: Row }[]; cursor: string; more: boolean; keys?: Record<string, string> }
    await db.tx(async () => {
      for (const r of page.records) await applyPulled(env, r.table, r.row)
      if (page.keys) {
        await db.run('UPDATE devices SET key_hex = NULL')
        for (const [id, key] of Object.entries(page.keys)) await db.run('UPDATE devices SET key_hex = ? WHERE id = ?', [key, id])
      }
      // Stored with the page it belongs to, so an interrupted first sync resumes where it stopped.
      await db.run("INSERT INTO meta (key, value) VALUES ('sync_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [page.cursor])
    })
    total += page.records.length
    if (!page.more) return { records: total }
  }
}
