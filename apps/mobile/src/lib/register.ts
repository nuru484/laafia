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
  /** Visited today: how it ended. These rows come last and are not reordered. */
  done: { outcome: 'routine' | 'followup' | 'refer'; at: number; followup_due: number | null } | null
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

  // `limit` is the whole day, so a nurse is not handed more than she can walk to. Pinned clients (open referrals,
  // newborns, anyone scheduled) always stay even past it; routine ones fill what is left and wait for another day.
  // Visited today stays on the list as done (the follow-up a discharge schedules is not a visit) and counts too,
  // so finishing a visit does not pull a new client in.
  const today = dayKey(env.now())
  const doneBy = new Map<string, NonNullable<TodayRow['done']>>()
  for (const v of [...visits].sort((a, b) => a.visited_at - b.visited_at)) {
    if (v.rule_id !== 'REFERRAL-CLOSED' && dayKey(v.visited_at) === today) doneBy.set(v.client_id, { outcome: v.outcome as 'routine' | 'followup' | 'refer', at: v.visited_at, followup_due: v.followup_due })
  }
  const all = rank(RISK_MODEL, clients, visits, open, env.now(), await bookedDue(env))
  const waiting = all.filter((r) => !doneBy.has(r.client_id))
  const pins = waiting.filter((r) => r.pinned)
  const ranked = [...pins, ...waiting.filter((r) => !r.pinned).slice(0, Math.max(0, limit - doneBy.size - pins.length))]
  const households = new Map((await db.all<{ id: string; community: string; landmark: string; lat: number | null; lng: number | null }>('SELECT id, community, landmark, lat, lng FROM households')).map((h) => [h.id, h]))
  const byId = new Map(clients.map((c) => [c.id, c]))
  const rows: TodayRow[] = ranked.map((r) => {
    const c = byId.get(r.client_id)!
    const h = households.get(c.household_id)
    return { client_id: c.id, name: c.name, code: c.code, type: c.type, score: r.score, reasons: r.reasons, pinned: r.pinned, community: h?.community ?? '', landmark: h?.landmark ?? '', lat: h?.lat ?? null, lng: h?.lng ?? null, done: null }
  })
  const done: TodayRow[] = [...doneBy].filter(([id]) => byId.has(id)).sort(([, a], [, b]) => a.at - b.at).map(([id, d]) => {
    const c = byId.get(id)!
    const h = households.get(c.household_id)
    return { client_id: c.id, name: c.name, code: c.code, type: c.type, score: 0, reasons: [], pinned: null, community: h?.community ?? '', landmark: h?.landmark ?? '', lat: h?.lat ?? null, lng: h?.lng ?? null, done: d }
  })

  const pinned = rows.filter((r) => r.pinned)
  const rest = rows.filter((r) => !r.pinned)
  const order = planRoute(rest.map((r) => ({ id: r.client_id, community: r.community, lat: r.lat, lng: r.lng })), origin)
  const walked = order.map((id) => rest.find((r) => r.client_id === id)!)
  const list = [...pinned, ...walked]

  const manual = await db.all<{ client_id: string; manual_rank: number }>('SELECT client_id, manual_rank FROM overrides WHERE day = ? AND deleted = 0', [today])
  if (!manual.length) return [...list, ...done]
  const pos = new Map(manual.map((m) => [m.client_id, m.manual_rank]))
  return [...[...list].sort((a, b) => (pos.get(a.client_id) ?? 1e6 + list.indexOf(a)) - (pos.get(b.client_id) ?? 1e6 + list.indexOf(b))), ...done]
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

export type PossibleDuplicate = { id: string; name: string; code: string; community: string; why: 'same phone' | 'same name' }

const sameName = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()

/**
 * Who may already be on this phone's register, checked before enrolling: the same phone number, or the same name
 * for the same kind of client. The nurse decides; two people can share a name.
 */
export async function possibleDuplicates(env: Env, p: { name: string; type: ClientType; phone: string | null }): Promise<PossibleDuplicate[]> {
  const rows = await env.db.all<{ id: string; name: string; code: string; type: string; phone: string | null; community: string }>(
    'SELECT c.id, c.name, c.code, c.type, c.phone, h.community FROM clients c JOIN households h ON h.id = c.household_id WHERE c.deleted = 0')
  const phone = p.phone?.trim() ? normalizePhone(p.phone) : null
  const name = sameName(p.name)
  const out: PossibleDuplicate[] = []
  for (const r of rows) {
    if (phone && r.phone === phone) out.push({ id: r.id, name: r.name, code: r.code, community: r.community, why: 'same phone' })
    else if (name && r.type === p.type && sameName(r.name) === name) out.push({ id: r.id, name: r.name, code: r.code, community: r.community, why: 'same name' })
  }
  return out
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
    const code = await nextClientCode(env)
    const id = env.uuid()
    const c = input.client
    await db.run(
      'INSERT INTO clients (id, household_id, code, type, name, sex, dob, edd, delivery_date, parity, prior_complications, birth_weight_g, nhis_active, next_of_kin, phone, updated_at, device_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, householdId, code, c.type, c.name.trim(), c.sex, c.dob, c.edd, c.delivery_date, c.parity, JSON.stringify(c.prior_complications), c.birth_weight_g, c.nhis_active ? 1 : 0, c.next_of_kin, c.phone ? normalizePhone(c.phone) : null, env.now(), env.self.device_id],
    )
    return { client_id: id, household_id: householdId, code }
  })
}

/** Device-scoped codes never collide with another phone's or with imported RG- codes. Call inside a transaction. */
async function nextClientCode(env: Env): Promise<string> {
  const seqRow = await env.db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'client_seq'")
  const seq = Number(seqRow?.value ?? 0) + 1
  await env.db.run("INSERT INTO meta (key, value) VALUES ('client_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(seq)])
  return `CL-${env.self.device_id}${String(seq).padStart(3, '0')}`
}

export type DeliveryInput = {
  /** The day of the birth, UTC midnight like every day in the app. */
  date: number
  outcome: 'live' | 'stillbirth'
  babies: { name: string; sex: 'f' | 'm'; birth_weight_g: number | null }[]
}

/** Older births are enrolled as after delivery instead: the postnatal period they would start is long over. */
const DELIVERY_WINDOW_DAYS = 60

/**
 * The birth. The mother becomes a postpartum client, so her postnatal visits count from that day, and each baby
 * born alive is enrolled as a newborn in her household, which pins them on Today for a visit within 48 hours.
 * A stillbirth enrols no baby and stays in her history for the next pregnancy.
 */
export async function recordDelivery(env: Env, motherId: string, d: DeliveryInput): Promise<{ babies: string[] }> {
  const { db } = env
  const m = await db.get<{ type: string; household_id: string; parity: number | null; prior_complications: string; nhis_active: number; phone: string | null; next_of_kin: string | null }>(
    'SELECT type, household_id, parity, prior_complications, nhis_active, phone, next_of_kin FROM clients WHERE id = ? AND deleted = 0', [motherId])
  if (!m) throw new Error('Unknown client')
  if (m.type !== 'pregnant') throw new Error('A delivery is recorded for a pregnant client only')
  const today = Math.floor(env.now() / DAY) * DAY
  if (d.date > today) throw new Error('The delivery date cannot be in the future')
  if (d.date < today - DELIVERY_WINDOW_DAYS * DAY) throw new Error(`Record a delivery within ${DELIVERY_WINDOW_DAYS} days of the birth`)
  const babies = d.outcome === 'live' ? d.babies : []
  if (d.outcome === 'live' && (babies.length < 1 || babies.length > 3)) throw new Error('A live birth needs one baby, or two or three for twins and triplets')
  for (const b of babies) {
    if (!b.name.trim()) throw new Error("Enter each baby's name, for example Baby of Amina")
    if (b.birth_weight_g !== null && (b.birth_weight_g < 400 || b.birth_weight_g > 6000)) throw new Error('Check the birth weight: it is in grams, for example 3100')
  }
  return db.tx(async () => {
    const history: string[] = JSON.parse(m.prior_complications || '[]')
    if (d.outcome === 'stillbirth' && !history.includes('stillbirth')) history.push('stillbirth')
    await db.run("UPDATE clients SET type = 'postpartum', delivery_date = ?, parity = ?, prior_complications = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?",
      [d.date, (m.parity ?? 0) + 1, JSON.stringify(history), env.now(), env.self.device_id, motherId])
    const ids: string[] = []
    for (const b of babies) {
      const id = env.uuid()
      // The baby's texts and next of kin are the mother's.
      await db.run(
        "INSERT INTO clients (id, household_id, code, type, name, sex, dob, edd, delivery_date, parity, prior_complications, birth_weight_g, nhis_active, next_of_kin, phone, updated_at, device_id) VALUES (?,?,?,'newborn',?,?,?,NULL,NULL,NULL,'[]',?,?,?,?,?,?)",
        [id, m.household_id, await nextClientCode(env), b.name.trim(), b.sex, d.date, b.birth_weight_g, m.nhis_active, m.phone ?? m.next_of_kin, m.phone, env.now(), env.self.device_id])
      ids.push(id)
    }
    return { babies: ids }
  })
}

export type ClientEdit = { name: string; phone: string; next_of_kin: string; community: string; head_name: string; landmark: string }

/** Corrects a client's details and her household's; both go to the server on the next sync. */
export async function updateClient(env: Env, id: string, e: ClientEdit): Promise<void> {
  const name = e.name.trim()
  if (!name) throw new Error('Enter her name')
  if (!e.community.trim()) throw new Error('Enter the community')
  if (!e.head_name.trim()) throw new Error('Enter the head of household')
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

/** One client's referrals, with where each one stands. */
export function clientReferrals(env: Env, clientId: string) {
  return listReferrals(env, 'r.client_id = ?', [clientId])
}

/** Facility mode: everything addressed to this facility. */
export async function facilityInbox(env: Env) {
  const me = await env.db.get<{ facility_code: string | null }>('SELECT facility_code FROM devices WHERE id = ?', [env.self.device_id])
  return listReferrals(env, 'r.destination_code = ?', [me?.facility_code ?? ''])
}
