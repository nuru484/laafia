import {
  PROTOCOLS,
  RISK_MODEL,
  deriveStatus,
  normalizePhone,
  planRoute,
  rank,
  referralAlert,
  type Alert,
  type Client,
  type ClientType,
  type ClientWireType,
  type Evaluation,
  type Point,
  type Reason,
  type ReferralStatus,
  type Visit,
} from '@laafia/core'
import { bookedDue } from './bookings'
import type { Env } from './relay'
import { TYPE_LABEL, signLabels } from './signs'

/* Register reads and writes behind the screens: the ranked day, visits, enrolment, referral lists. */

const DAY = 86_400_000
const OPEN: ReferralStatus[] = ['created', 'sent', 'received', 'arrived', 'treated']

type ClientRow = Omit<Client, 'prior_complications' | 'nhis_active'> & { prior_complications: string; nhis_active: number }
type VisitRow = Omit<Visit, 'answers'> & { answers: string }

export function toClient(r: ClientRow): Client {
  return { ...r, prior_complications: JSON.parse(r.prior_complications), nhis_active: r.nhis_active === 1 }
}
const toVisit = (r: VisitRow): Visit => ({ ...r, answers: JSON.parse(r.answers) })

async function eventsByReferral(env: Env) {
  const rows = await env.db.all<{ referral_id: string; status: ReferralStatus; at: number }>('SELECT referral_id, status, at FROM referral_events WHERE deleted = 0')
  const map = new Map<string, { status: ReferralStatus; at: number }[]>()
  for (const r of rows) map.set(r.referral_id, [...(map.get(r.referral_id) ?? []), r])
  return map
}

export type TodayRow = {
  client_id: string; name: string; code: string; type: ClientType; score: number; reasons: Reason[]
  pinned: 'open_referral' | 'newborn_48h' | 'scheduled' | null; community: string; landmark: string; lat: number | null; lng: number | null
}

/**
 * Today's visits (spec 6): rank everyone, keep every pinned case (open
 * referrals, newborns, anyone scheduled for today) whatever the cap, add the
 * top `limit` of the rest, and walk those in route order from the compound.
 * The CHO's manual order for today, if any, wins.
 */
export async function todayList(env: Env, origin: Point, limit = 12): Promise<TodayRow[]> {
  const { db } = env
  const clients = (await db.all<ClientRow>('SELECT * FROM clients WHERE deleted = 0')).map(toClient)
  const visits = (await db.all<VisitRow>('SELECT * FROM visits WHERE deleted = 0')).map(toVisit)
  const events = await eventsByReferral(env)
  const refs = await db.all<{ id: string; client_id: string | null }>('SELECT id, client_id FROM referrals WHERE deleted = 0')
  const open = new Set(refs.filter((r) => r.client_id && OPEN.includes(deriveStatus(events.get(r.id) ?? []))).map((r) => r.client_id!))

  const all = rank(RISK_MODEL, clients, visits, open, env.now(), await bookedDue(env))
  const ranked = [...all.filter((r) => r.pinned), ...all.filter((r) => !r.pinned).slice(0, limit)]
  const households = new Map((await db.all<{ id: string; community: string; landmark: string; lat: number | null; lng: number | null }>('SELECT id, community, landmark, lat, lng FROM households')).map((h) => [h.id, h]))
  const byId = new Map(clients.map((c) => [c.id, c]))
  const rows: TodayRow[] = ranked.map((r) => {
    const c = byId.get(r.client_id)!
    const h = households.get(c.household_id)
    return { client_id: c.id, name: c.name, code: c.code, type: c.type, score: r.score, reasons: r.reasons, pinned: r.pinned, community: h?.community ?? '', landmark: h?.landmark ?? '', lat: h?.lat ?? null, lng: h?.lng ?? null }
  })

  const pinned = rows.filter((r) => r.pinned)
  const rest = rows.filter((r) => !r.pinned)
  const order = planRoute(rest.map((r) => ({ id: r.client_id, community: r.community, lat: r.lat, lng: r.lng })), origin)
  const walked = order.map((id) => rest.find((r) => r.client_id === id)!)
  const list = [...pinned, ...walked]

  const manual = await db.all<{ client_id: string; manual_rank: number }>('SELECT client_id, manual_rank FROM overrides WHERE day = ? AND deleted = 0', [dayKey(env.now())])
  if (!manual.length) return list
  const pos = new Map(manual.map((m) => [m.client_id, m.manual_rank]))
  return [...list].sort((a, b) => (pos.get(a.client_id) ?? 1e6 + list.indexOf(a)) - (pos.get(b.client_id) ?? 1e6 + list.indexOf(b)))
}

export const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)

/** The CHO's own order for today, stored as overrides that sync to the server as ranking feedback. */
export async function setManualOrder(env: Env, clientIds: string[]): Promise<void> {
  const day = dayKey(env.now())
  await env.db.tx(async () => {
    await env.db.run('UPDATE overrides SET deleted = 1, synced = 0, updated_at = ? WHERE day = ?', [env.now(), day])
    for (const [i, id] of clientIds.entries()) {
      await env.db.run('INSERT INTO overrides (id, day, client_id, manual_rank, updated_at, device_id) VALUES (?,?,?,?,?,?)', [env.uuid(), day, id, i, env.now(), env.self.device_id])
    }
  })
}

export type VisitInput = {
  client_id: string
  protocol_id: keyof typeof PROTOCOLS
  answers: Record<string, unknown>
  evaluation: Evaluation
  muac_mm?: number | null
  notes?: string | null
}

export async function saveVisit(env: Env, v: VisitInput): Promise<string> {
  const id = env.uuid()
  const due = v.evaluation.outcome === 'followup' ? env.now() + (v.evaluation.followup_days ?? 1) * DAY : null
  await env.db.run(
    'INSERT INTO visits (id, client_id, protocol_id, protocol_version, visited_at, answers, outcome, rule_id, followup_due, muac_mm, notes, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, v.client_id, v.protocol_id, PROTOCOLS[v.protocol_id].version, env.now(), JSON.stringify(v.answers), v.evaluation.outcome, v.evaluation.rule_id, due, v.muac_mm ?? null, v.notes ?? null, env.now(), env.self.device_id],
  )
  return id
}

export type EnrolInput = {
  household: { id?: string; community: string; head_name: string; landmark: string; lat: number | null; lng: number | null; consent: boolean }
  client: Omit<Client, 'id' | 'household_id' | 'code'> & { next_of_kin: string | null }
}

/** New household (or an existing one) and a client. Consent is required (spec 18.3). */
export async function enrol(env: Env, input: EnrolInput): Promise<{ client_id: string; household_id: string; code: string }> {
  const { db } = env
  if (!input.household.consent) throw new Error('Verbal consent must be recorded before enrolment')
  return db.tx(async () => {
    let householdId = input.household.id
    if (!householdId) {
      householdId = env.uuid()
      const h = input.household
      await db.run('INSERT INTO households (id, community, head_name, landmark, lat, lng, consent_at, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?,?)',
        [householdId, h.community.trim(), h.head_name.trim(), h.landmark.trim(), h.lat, h.lng, env.now(), env.now(), env.self.device_id])
    }
    // Device-scoped codes never collide with another phone's or with imported RG- codes.
    const seqRow = await db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'client_seq'")
    const seq = Number(seqRow?.value ?? 0) + 1
    await db.run("INSERT INTO meta (key, value) VALUES ('client_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(seq)])
    const code = `CL-${env.self.device_id}${String(seq).padStart(3, '0')}`
    const id = env.uuid()
    const c = input.client
    await db.run(
      'INSERT INTO clients (id, household_id, code, type, name, sex, dob, edd, delivery_date, parity, prior_complications, birth_weight_g, nhis_active, next_of_kin, phone, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, householdId, code, c.type, c.name.trim(), c.sex, c.dob, c.edd, c.delivery_date, c.parity, JSON.stringify(c.prior_complications), c.birth_weight_g, c.nhis_active ? 1 : 0, c.next_of_kin, c.phone ? normalizePhone(c.phone) : null, env.now(), env.self.device_id],
    )
    return { client_id: id, household_id: householdId, code }
  })
}

export type ClientEdit = { name: string; phone: string; next_of_kin: string; community: string; head_name: string; landmark: string }

/** Corrects a client's details and her household's; both go to the server on the next sync. */
export async function updateClient(env: Env, id: string, e: ClientEdit): Promise<void> {
  const name = e.name.trim()
  if (!name) throw new Error('Enter her name')
  const phone = e.phone.trim() ? normalizePhone(e.phone) : null
  if (phone && !/^0\d{9}$/.test(phone)) throw new Error('Enter a Ghana phone number, for example 024 123 4567')
  const c = await env.db.get<{ household_id: string }>('SELECT household_id FROM clients WHERE id = ?', [id])
  if (!c) throw new Error('Unknown client')
  await env.db.tx(async () => {
    await env.db.run('UPDATE clients SET name = ?, phone = ?, next_of_kin = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?',
      [name, phone, e.next_of_kin.trim() || null, env.now(), env.self.device_id, id])
    await env.db.run('UPDATE households SET community = ?, head_name = ?, landmark = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?',
      [e.community.trim(), e.head_name.trim(), e.landmark.trim(), env.now(), env.self.device_id, c.household_id])
  })
}

export type ReferralListRow = {
  id: string; short_id: string; client_id: string | null; client_code: string; client_name: string | null; client_type: ClientWireType
  type_label: string; context: string; urgency: number; signs: string[]; destination_code: string; destination_name: string
  status: ReferralStatus; alert: Alert; created_at: number; origin_device_id: string; origin_name: string | null; origin_phone: string | null
}

async function listReferrals(env: Env, where: string, params: (string | number)[]): Promise<ReferralListRow[]> {
  const rows = await env.db.all<{
    id: string; short_id: string; client_id: string | null; client_code: string; client_name: string | null; client_type: ClientWireType; context: string
    urgency: number; sign_codes: string; destination_code: string; destination_name: string | null; created_at: number; origin_device_id: string; origin_name: string | null; origin_phone: string | null
  }>(
    `SELECT r.id, r.short_id, r.client_id, r.client_code, c.name AS client_name, r.client_type, r.context, r.urgency, r.sign_codes, r.destination_code,
            f.name AS destination_name, r.created_at, r.origin_device_id, d.user_name AS origin_name, d.phone_number AS origin_phone
       FROM referrals r
       LEFT JOIN clients c ON c.id = r.client_id
       LEFT JOIN facilities f ON f.code = r.destination_code
       LEFT JOIN devices d ON d.id = r.origin_device_id
      WHERE r.deleted = 0 AND ${where}`, params)
  const events = await eventsByReferral(env)
  return rows
    .map((r) => {
      const ev = events.get(r.id) ?? []
      return {
        ...r, destination_name: r.destination_name ?? r.destination_code, type_label: TYPE_LABEL[r.client_type] ?? 'Client',
        signs: signLabels(r.client_type, JSON.parse(r.sign_codes)), status: deriveStatus(ev), alert: referralAlert(ev, r.urgency as 1 | 2 | 3, env.now()),
      }
    })
    .sort((a, b) => Number(!OPEN.includes(a.status)) - Number(!OPEN.includes(b.status)) || b.urgency - a.urgency || b.created_at - a.created_at)
}

/** Referrals this phone made. */
export function referralList(env: Env) {
  return listReferrals(env, 'r.origin_device_id = ?', [env.self.device_id])
}

/** Facility mode: everything addressed to this facility. */
export async function facilityInbox(env: Env) {
  const me = await env.db.get<{ facility_code: string | null }>('SELECT facility_code FROM devices WHERE id = ?', [env.self.device_id])
  return listReferrals(env, 'r.destination_code = ?', [me?.facility_code ?? ''])
}
