import { STATUS_TEXT, TYPE_NAME } from '../features/format'
import { facilityInbox, referralList } from './register'
import type { Env } from './relay'

/*
 * The month's work as one printable page, so the nurse copies nothing by
 * hand: a CHO's own visits and referrals, or the referrals a facility
 * received. Months are UTC, which is Ghana's local time.
 */

const OUTCOME: Record<string, string> = { routine: 'Routine', followup: 'Follow up', refer: 'Refer' }
const CHECKLIST: Record<string, string> = { maternal: 'Mother', young_infant: 'Young infant', child: 'Child' }

export type MonthReport = {
  month: string; nurse: string; facility: string; facilityMode: boolean
  totals: { visits: number; routine: number; followup: number; refer: number; households: number; referrals: number; referrals_closed: number }
  visits: { at: number; code: string; name: string; type: string; checklist: string; outcome: string; rule: string }[]
  referrals: { at: number; code: string; name: string; place: string; status: string; signs: string }[]
}

const monthEnd = (start: number) => { const d = new Date(start); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) }

export async function monthlyReport(env: Env, monthStart: number): Promise<MonthReport> {
  const { db } = env
  const end = monthEnd(monthStart)
  const facilityMode = env.self.role === 'facility'
  const me = await db.get<{ user_name: string; facility: string | null }>(
    'SELECT d.user_name, f.name AS facility FROM devices d LEFT JOIN facilities f ON f.code = d.facility_code WHERE d.id = ?', [env.self.device_id])

  // Follow-ups created when a referral closes are scheduling records, not visits.
  const visits = facilityMode ? [] : await db.all<{ at: number; code: string; name: string; type: string; protocol_id: string; outcome: string; rule: string }>(
    `SELECT v.visited_at AS at, c.code, c.name, c.type, v.protocol_id, v.outcome, v.rule_id AS rule FROM visits v JOIN clients c ON c.id = v.client_id
      WHERE v.deleted = 0 AND v.device_id = ? AND v.rule_id != 'REFERRAL-CLOSED' AND v.visited_at >= ? AND v.visited_at < ? ORDER BY v.visited_at`,
    [env.self.device_id, monthStart, end])
  const households = facilityMode ? 0 : (await db.get<{ n: number }>('SELECT count(*) AS n FROM households WHERE deleted = 0 AND consent_at >= ? AND consent_at < ?', [monthStart, end]))?.n ?? 0
  const refs = (await (facilityMode ? facilityInbox(env) : referralList(env)))
    .filter((r) => r.created_at >= monthStart && r.created_at < end)
    .sort((a, b) => a.created_at - b.created_at)

  const count = (o: string) => visits.filter((v) => v.outcome === o).length
  return {
    month: new Date(monthStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    nurse: me?.user_name ?? '', facility: me?.facility ?? '', facilityMode,
    totals: {
      visits: visits.length, routine: count('routine'), followup: count('followup'), refer: count('refer'), households,
      referrals: refs.length, referrals_closed: refs.filter((r) => r.status === 'closed').length,
    },
    visits: visits.map((v) => ({ at: v.at, code: v.code, name: v.name, type: TYPE_NAME[v.type] ?? v.type, checklist: CHECKLIST[v.protocol_id] ?? v.protocol_id, outcome: OUTCOME[v.outcome] ?? v.outcome, rule: v.rule })),
    referrals: refs.map((r) => ({
      at: r.created_at, code: r.client_code, name: r.client_name ?? '', place: (facilityMode ? r.origin_name : r.destination_name) ?? '',
      status: STATUS_TEXT[r.status], signs: r.signs.join(', '),
    })),
  }
}

const ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string | number) => String(s).replace(/[&<>"']/g, (ch) => ENTITY[ch]!)
const date = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const table = (head: string[], rows: (string | number)[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}">None this month</td></tr>`}</tbody></table>`

/** A4 page for the Android print dialog, which can also save it as a PDF. */
export function reportHtml(r: MonthReport): string {
  const t = r.totals
  const summary = r.facilityMode
    ? [['Referrals received', t.referrals], ['Discharged', t.referrals_closed]]
    : [['Visits', t.visits], ['Routine', t.routine], ['Follow up', t.followup], ['Referred', t.refer], ['Households enrolled', t.households], ['Referrals discharged', `${t.referrals_closed} of ${t.referrals}`]]
  return `<!doctype html><html><head><meta charset="utf-8"><title>Laafia ${esc(r.month)}</title><style>
    @page { size: A4; margin: 14mm }
    body { font-family: sans-serif; font-size: 11pt; color: #111 }
    h1 { font-size: 16pt; margin: 0 } h2 { font-size: 12pt; margin: 18px 0 6px }
    p { margin: 2px 0 } .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px }
    .stat { border: 1px solid #999; padding: 6px 10px } .stat b { display: block; font-size: 14pt }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt } th, td { border: 1px solid #999; padding: 4px; text-align: left; vertical-align: top }
    th { background: #eee }
  </style></head><body>
    <h1>Laafia monthly report: ${esc(r.month)}</h1>
    <p>${esc(r.nurse)}${r.facility ? `, ${esc(r.facility)}` : ''}</p>
    <div class="stats">${summary.map(([k, v]) => `<div class="stat"><b>${esc(v!)}</b>${esc(k!)}</div>`).join('')}</div>
    ${r.facilityMode ? '' : `<h2>Visits</h2>${table(['Date', 'Code', 'Name', 'Client', 'Checklist', 'Outcome', 'Rule'], r.visits.map((v) => [date(v.at), v.code, v.name, v.type, v.checklist, v.outcome, v.rule]))}`}
    <h2>${r.facilityMode ? 'Referrals received' : 'Referrals made'}</h2>
    ${table(['Date', 'Code', 'Name', r.facilityMode ? 'From' : 'To', 'Danger signs', 'Status'], r.referrals.map((x) => [date(x.at), x.code, x.name, x.place, x.signs, x.status]))}
  </body></html>`
}
