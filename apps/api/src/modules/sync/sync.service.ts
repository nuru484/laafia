import { Prisma, savepoint, type Tx } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import type { Device } from '../../platform/middleware/auth.ts'
import { keysFor } from '../auth/index.ts'
import { pushEvent, pushReferral, writeAndPublish, type PushEvent, type PushReferral } from '../referrals/index.ts'
import { MAX_BATCH, ROW_SCHEMAS, type PullInput, type PushInput, type PushTable } from './sync.schemas.ts'

/** Last sync time and app version (header X-App-Version) per device, for the dashboard. */
export async function recordContact(deps: Deps, deviceId: string, appVersion: string | null) {
  const lastSyncAt = deps.clock()
  await deps.prisma.deviceStatus.upsert({
    where: { deviceId },
    create: { deviceId, lastSyncAt, appVersion },
    update: { lastSyncAt, ...(appVersion ? { appVersion } : {}) },
  })
}

// --- Push

type LwwTable = Exclude<PushTable, 'referrals' | 'referral_events'>
const JSON_COLUMNS = new Set(['prior_complications', 'risk_flags', 'answers'])
const IDENT = /^[a-z][a-z0-9_]*$/

/**
 * Last-writer-wins upsert on id. Older or equal updated_at is a no-op; a row owned by another catchment is refused.
 * Raw: Prisma's upsert cannot make the update conditional on the stored row (updated_at and facility_id) in one
 * statement. Values are bound parameters; identifiers come only from the table's Zod schema keys (checked against IDENT).
 */
async function lww(tx: Tx, table: LwwTable, row: Record<string, unknown>, facilityId: string | null): Promise<string | null> {
  const cols = Object.keys(row)
  if (!cols.every((c) => IDENT.test(c))) throw new Error('unexpected column name')
  const q = (c: string) => Prisma.raw(`"${c}"`)
  const values = cols.map((c) => (JSON_COLUMNS.has(c) ? Prisma.sql`${JSON.stringify(row[c])}::jsonb` : Prisma.sql`${row[c]}`))
  const written = await tx.$queryRaw<{ id: string }[]>`
    insert into ${q(table)} as t (${Prisma.join(cols.map(q))}, facility_id)
    values (${Prisma.join(values)}, ${facilityId})
    on conflict (id) do update set ${Prisma.join(cols.filter((c) => c !== 'id').map((c) => Prisma.sql`${q(c)} = excluded.${q(c)}`))}
    where excluded.updated_at > t.updated_at and t.facility_id is not distinct from excluded.facility_id
    returning id`
  if (written.length) return null
  const existing = await tx.$queryRaw<{ facility_id: string | null }[]>`select facility_id from ${q(table)} where id = ${row.id}`
  return existing[0] && existing[0].facility_id !== facilityId ? 'forbidden' : null
}

export async function push(deps: Deps, device: Device, body: PushInput) {
  if (body.device_id && body.device_id !== device.id) throw new HttpError(403, 'device_mismatch', 'device_id does not match the token')
  if (body.records.length > MAX_BATCH) throw new HttpError(413, 'batch_too_large', `At most ${MAX_BATCH} records per push`)
  const accepted: string[] = []
  const rejected: { id: string | null; table: string; reason: string }[] = []
  await writeAndPublish(deps, async (tx, touched) => {
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
        const reason = await savepoint(tx, () => {
          if (table === 'referrals') return pushReferral(tx, device, row as unknown as PushReferral, touched)
          if (table === 'referral_events') return pushEvent(tx, device, row as unknown as PushEvent, touched)
          return lww(tx, table as LwwTable, row, device.facilityId)
        })
        if (reason) rejected.push({ id: row.id, table, reason })
        else accepted.push(row.id)
      } catch (e) {
        deps.logger.error('push_row_failed', { table, id: row.id, error: String(e) })
        rejected.push({ id: row.id, table, reason: 'server_error' })
      }
    }
  })
  return { accepted, rejected }
}

// --- Pull

const DAY = 86_400_000
const ACTIVE = { postpartumDays: 42, childMonths: 60, visitDays: 365, closedReferralDays: 30 }
const SYNC_TABLES = ['facilities', 'devices', 'households', 'clients', 'visits', 'transport_providers', 'transport_requests', 'referrals', 'referral_events'] as const
type SyncTable = (typeof SYNC_TABLES)[number]
type Where = Record<string, unknown>
const NOTHING: Where = { id: { in: [] } }

/**
 * First-sync filters. Prisma cannot express "the latest visit has a follow-up" or "has an open
 * referral" without relations between phone-synced tables (they have no foreign keys on purpose), so the
 * qualifying ids are computed first.
 * Limit: the id lists are sized by one catchment; a catchment of tens of thousands would need SQL views.
 */
async function snapshotFilters(deps: Deps, facilityId: string, myReferrals: Where, now: number) {
  const { prisma } = deps
  const openReferrals = await prisma.referral.findMany({ where: { clientId: { not: null }, status: { notIn: ['closed', 'cancelled'] }, deleted: false }, select: { clientId: true } })
  const latestVisits = await prisma.visit.findMany({ where: { facilityId }, orderBy: [{ clientId: 'asc' }, { visitedAt: 'desc' }], distinct: ['clientId'], select: { clientId: true, followupDue: true } })
  const active: Where = {
    OR: [
      { type: 'pregnant' },
      { type: 'postpartum', deliveryDate: { gte: now - ACTIVE.postpartumDays * DAY } },
      { type: { in: ['newborn', 'child'] }, dob: { gte: now - Math.round(ACTIVE.childMonths * 30.44) * DAY } },
      { id: { in: openReferrals.map((r) => r.clientId!) } },
      { id: { in: latestVisits.filter((v) => v.followupDue !== null).map((v) => v.clientId) } },
    ],
  }
  const activeClients = await prisma.client.findMany({ where: { facilityId, ...active }, select: { id: true, householdId: true } })
  const withClients = await prisma.client.findMany({ where: { facilityId }, distinct: ['householdId'], select: { householdId: true } })
  const recent = await prisma.referralEvent.findMany({ where: { at: { gte: now - ACTIVE.closedReferralDays * DAY } }, distinct: ['referralId'], select: { referralId: true } })
  const needed: Where = { AND: [myReferrals, { OR: [{ status: { notIn: ['closed', 'cancelled'] } }, { id: { in: recent.map((e) => e.referralId) } }] }] }
  const neededIds = (await prisma.referral.findMany({ where: needed, select: { id: true } })).map((r) => r.id)
  return {
    clients: active,
    households: { OR: [{ id: { in: activeClients.map((c) => c.householdId) } }, { id: { notIn: withClients.map((c) => c.householdId) } }] },
    visits: { visitedAt: { gte: now - ACTIVE.visitDays * DAY }, clientId: { in: activeClients.map((c) => c.id) } },
    transport_providers: { active: true },
    transport_requests: { status: { in: ['requested', 'coming'] } },
    referrals: needed,
    referral_events: { referralId: { in: neededIds } },
  } satisfies Partial<Record<SyncTable, Where>>
}

export async function pull(deps: Deps, device: Device, { since, limit }: PullInput) {
  const { prisma } = deps
  const now = deps.clock()
  let [seq, base] = since ? (since.split('.').map(Number) as [number, number]) : [0, -1]
  // Raw: the current value of the sync_seq sequence; Prisma has no sequence API.
  if (base < 0) base = Number((await prisma.$queryRaw<{ v: bigint }[]>`select last_value as v from sync_seq`)[0]!.v)

  const f = device.facilityId
  const home = f ? await prisma.facility.findUnique({ where: { id: f }, select: { districtId: true } }) : null
  const district = home?.districtId ?? null
  const mine: Where = f ? { facilityId: f } : NOTHING
  const myReferrals: Where = f ? { OR: [{ facilityId: f }, { destinationFacilityId: f }] } : NOTHING
  const myReferralIds = f ? (await prisma.referral.findMany({ where: myReferrals, select: { id: true } })).map((r) => r.id) : []
  const snapshot = f && seq < base ? await snapshotFilters(deps, f, myReferrals, now) : null

  const scope: Record<SyncTable, Where> = {
    facilities: district ? { districtId: district } : {},
    devices: district ? { facility: { districtId: district } } : {},
    households: mine, clients: mine, visits: mine, transport_providers: mine, transport_requests: mine,
    referrals: myReferrals,
    referral_events: { referralId: { in: myReferralIds } },
  }
  const page = { orderBy: { seq: 'asc' as const }, take: limit }
  const find: Record<SyncTable, (where: Where) => Promise<{ seq: number }[]>> = {
    facilities: (where) => prisma.facility.findMany({ where, ...page }),
    devices: (where) => prisma.device.findMany({ where, ...page, omit: { keyHex: true } }),
    households: (where) => prisma.household.findMany({ where, ...page }),
    clients: (where) => prisma.client.findMany({ where, ...page }),
    visits: (where) => prisma.visit.findMany({ where, ...page }),
    transport_providers: (where) => prisma.transportProvider.findMany({ where, ...page }),
    transport_requests: (where) => prisma.transportRequest.findMany({ where, ...page }),
    referrals: (where) => prisma.referral.findMany({ where, ...page }),
    referral_events: (where) => prisma.referralEvent.findMany({ where, ...page }),
  }
  const results = await Promise.all(SYNC_TABLES.map(async (table) => {
    const filter = snapshot?.[table as keyof typeof snapshot]
    const where = { AND: [{ seq: { gt: seq } }, scope[table], filter ? { OR: [{ seq: { gt: base } }, filter] } : {}] }
    return { table, rows: await find[table](where) }
  }))
  // Merge by seq and cut at `limit`. Every table that hit its limit has all its rows up to the cut, so the cursor never skips a row.
  const all = results.flatMap((r) => r.rows.map((row) => ({ table: r.table, row }))).sort((a, b) => a.row.seq - b.row.seq)
  const merged = all.slice(0, limit)
  const last = merged.length ? merged[merged.length - 1]!.row.seq : Math.max(seq, base)
  const records = merged.map(({ table, row }) => ({ table, row: toWire(row) }))
  return { records, cursor: `${last}.${base}`, more: all.length > limit || results.some((r) => r.rows.length === limit), keys: await keysFor(deps, device) }
}
