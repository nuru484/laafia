import { and, asc, eq, getTableColumns, gt, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Device } from './auth.ts'
import { db, type Tx } from './db.ts'
import { HttpError, log } from './http.ts'
import { pushEvent, pushReferral, writeAndPublish } from './referrals.ts'
import { SYNCED, devices, referral_events, referrals } from './schema.ts'

// --- Row contracts (docs/API.md). Unknown keys (e.g. the phone's `synced`) are stripped.

const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean)
const ms = z.number().int().nonnegative()
const id = z.string().min(1).max(64)
const str = (max = 200) => z.string().max(max)
const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? null)
const strings = z.array(str(64)).max(50).default([])
const DEVICE_ID = /^[A-Z0-9]{2,8}$/
const SHORT_ID = /^[A-Z2-7]{8}$/
const CLIENT_TYPE = z.enum(['pregnant', 'postpartum', 'newborn', 'child'])

const base = { id, updated_at: ms, device_id: opt(str(64)), deleted: bool.default(false) }

export const ROW_SCHEMAS = {
  households: z.object({
    ...base, community: str(), head_name: str(), landmark: str(500).default(''),
    lat: opt(z.number().min(-90).max(90)), lng: opt(z.number().min(-180).max(180)), consent_at: opt(ms),
  }),
  clients: z.object({
    ...base, household_id: id, code: str(32), type: CLIENT_TYPE, name: str(), sex: opt(z.enum(['f', 'm'])),
    dob: opt(z.number().int()), edd: opt(ms), delivery_date: opt(ms), parity: opt(z.number().int().min(0).max(30)),
    prior_complications: strings, birth_weight_g: opt(z.number().int().min(0).max(9000)), nhis_active: bool.default(false), risk_flags: strings,
  }),
  visits: z.object({
    ...base, client_id: id, protocol_id: str(64), visited_at: ms, answers: z.record(z.string(), z.unknown()).default({}),
    outcome: z.enum(['routine', 'followup', 'refer']), rule_id: str(64), followup_due: opt(ms), notes: opt(str(2000)), muac_mm: opt(z.number().int().min(0).max(400)),
  }),
  referrals: z.object({
    ...base, origin_device_id: z.string().regex(DEVICE_ID), short_id: z.string().regex(SHORT_ID),
    client_id: opt(id), visit_id: opt(id), client_code: opt(str(32)), client_type: opt(CLIENT_TYPE), context: opt(str(16)),
    urgency: opt(z.number().int().min(1).max(3)), danger_signs: strings, destination_facility_id: opt(id), next_of_kin: opt(str(20)),
    delivered_via: opt(z.enum(['sms', 'qr', 'https'])),
  }),
  referral_events: z.object({
    ...base, referral_id: id, origin_device_id: z.string().regex(DEVICE_ID), short_id: z.string().regex(SHORT_ID),
    status: z.enum(['created', 'carrying', 'sent', 'received', 'arrived', 'treated', 'closed', 'cancelled']),
    at: ms, source_device_id: str(64), via: z.enum(['sms', 'qr', 'https', 'local']),
  }),
  transport_providers: z.object({
    ...base, name: str(), phone: str(20), vehicle: str().default(''), community: str().default(''), active: bool.default(true),
  }),
  transport_requests: z.object({
    ...base, referral_id: opt(id), provider_id: id, status: z.enum(['requested', 'coming', 'declined', 'done']), scheduled_for: opt(ms),
  }),
}
type PushTable = keyof typeof ROW_SCHEMAS

export const MAX_BATCH = 200
export const PushBody = z.object({
  device_id: z.string().optional(),
  records: z.array(z.object({ table: z.string(), row: z.record(z.string(), z.unknown()) })),
})

/** Last-writer-wins upsert on id. Older or equal updated_at is a no-op; a row owned by another catchment is refused. */
async function lww(tx: Tx, table: PgTable, row: Record<string, unknown>, facilityId: string | null): Promise<string | null> {
  const cols = getTableColumns(table) as Record<string, any>
  const set = Object.fromEntries(Object.keys(row).filter((c) => c !== 'id').map((c) => [c, sql.raw(`excluded."${c}"`)]))
  const written = await tx.insert(table).values({ ...row, facility_id: facilityId })
    .onConflictDoUpdate({ target: cols.id, set, setWhere: sql`excluded.updated_at > ${cols.updated_at} and ${cols.facility_id} is not distinct from excluded.facility_id` })
    .returning({ id: cols.id })
  if (written.length) return null
  const [existing] = await tx.select({ facility_id: cols.facility_id }).from(table).where(eq(cols.id, row.id))
  return existing && existing.facility_id !== facilityId ? 'forbidden' : null
}

export async function push(device: Device, body: z.infer<typeof PushBody>) {
  if (body.device_id && body.device_id !== device.id) throw new HttpError(403, 'device_mismatch', 'device_id does not match the token')
  if (body.records.length > MAX_BATCH) throw new HttpError(413, 'batch_too_large', `At most ${MAX_BATCH} records per push`)
  const accepted: string[] = []
  const rejected: { id: string | null; table: string; reason: string }[] = []
  await writeAndPublish(async (tx, touched) => {
    for (const { table, row: raw } of body.records) {
      const rawId = typeof raw.id === 'string' ? raw.id : null
      const schema = ROW_SCHEMAS[table as PushTable]
      if (!schema) {
        rejected.push({ id: rawId, table, reason: 'unknown_table' })
        continue
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        const i = parsed.error.issues[0]!
        rejected.push({ id: rawId, table, reason: `invalid: ${i.path.join('.')} ${i.message}` })
        continue
      }
      const row = { ...parsed.data, device_id: parsed.data.device_id ?? device.id }
      try {
        // Savepoint per row, so one bad row does not abort the batch.
        const reason = await tx.transaction(async (sp) => {
          if (table === 'referrals') return pushReferral(sp, device, row as never, touched)
          if (table === 'referral_events') return pushEvent(sp, device, row as never, touched)
          return lww(sp, SYNCED[table as Exclude<PushTable, 'referrals' | 'referral_events'>], row, device.facility_id)
        })
        if (reason) rejected.push({ id: row.id, table, reason })
        else accepted.push(row.id)
      } catch (e) {
        log('error', 'push_row_failed', { table, id: row.id, error: String(e) })
        rejected.push({ id: row.id, table, reason: 'server_error' })
      }
    }
  })
  return { accepted, rejected }
}

// --- Pull

export const PullQuery = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})

export async function pull(device: Device, { since, limit }: z.infer<typeof PullQuery>) {
  const f = device.facility_id
  const mine = (t: { facility_id: any }) => (f ? eq(t.facility_id, f) : sql`false`)
  const myReferrals = f ? or(eq(referrals.facility_id, f), eq(referrals.destination_facility_id, f))! : sql`false`
  const { key_hex: _k, ...deviceCols } = getTableColumns(devices)

  const scoped: { table: keyof typeof SYNCED; rows: Promise<{ seq: number }[]> }[] = []
  const add = (table: keyof typeof SYNCED, q: (where: (scope: SQL | undefined) => SQL) => Promise<{ seq: number }[]>) => {
    const t = SYNCED[table]
    scoped.push({ table, rows: q((scope) => and(gt(t.seq, since), scope)!) })
  }
  const page = <T extends PgTable & { seq: any }>(t: T, scope?: SQL) => (w: (s: SQL | undefined) => SQL) =>
    db.select().from(t as PgTable).where(w(scope)).orderBy(asc(t.seq)).limit(limit) as unknown as Promise<{ seq: number }[]>

  add('facilities', page(SYNCED.facilities))
  add('devices', (w) => db.select(deviceCols).from(devices).where(w(undefined)).orderBy(asc(devices.seq)).limit(limit))
  for (const t of ['households', 'clients', 'visits', 'transport_providers', 'transport_requests'] as const) add(t, page(SYNCED[t], mine(SYNCED[t])))
  add('referrals', page(referrals, myReferrals))
  add('referral_events', page(referral_events, inArray(referral_events.referral_id, db.select({ id: referrals.id }).from(referrals).where(myReferrals))))

  const results = await Promise.all(scoped.map(async (s) => ({ table: s.table, rows: await s.rows })))
  // Merge by seq and cut at `limit`. Every table that hit its limit has all its rows up to the cut, so the cursor never skips a row.
  const all = results.flatMap((r) => r.rows.map((row) => ({ table: r.table, row }))).sort((a, b) => a.row.seq - b.row.seq)
  const merged = all.slice(0, limit)
  const cursor = merged.length ? merged[merged.length - 1]!.row.seq : since
  const records = merged.map(({ table, row: { seq: _seq, ...row } }) => ({ table, row }))
  return { records, cursor, more: all.length > limit || results.some((r) => r.rows.length === limit) }
}
