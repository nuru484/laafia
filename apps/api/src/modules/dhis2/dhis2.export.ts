import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/*
 * DHIS2 export (spec 17), pure: Laafia records for one facility and month in, a Tracker
 * payload ({ trackedEntities } with nested enrollments and events, ready for POST
 * /api/tracker) and the monthly aggregate dataValueSet out. UIDs are derived from Laafia
 * ids, so re-exporting the same records updates rather than duplicates.
 */

export const Mapping = z.object({
  trackedEntityType: z.string(),
  attributes: z.object({ first_name: z.string(), last_name: z.string(), sex: z.string(), code: z.string() }),
  sex_values: z.record(z.string(), z.string()),
  programs: z.record(z.string(), z.object({ program: z.string(), visit_stage: z.string(), referral_stage: z.string() })),
  data_elements: z.object({
    visit: z.object({ summary: z.string() }),
    referral: z.object({ summary: z.string() }),
  }),
  org_units: z.record(z.string(), z.string()),
  aggregate: z.object({
    data_set: z.string(),
    data_elements: z.object({ anc_contacts: z.string(), pnc_within_48h: z.string(), referrals_made: z.string(), referrals_completed: z.string() }),
  }),
})
export type Mapping = z.infer<typeof Mapping>

const DEFAULT_MAPPING = fileURLToPath(new URL('../../../../../docs/dhis2-mapping.json', import.meta.url))
export const loadMapping = (path: string = DEFAULT_MAPPING): Mapping => Mapping.parse(JSON.parse(readFileSync(path, 'utf8')))

export type ExportInput = {
  facility: { id: string; code: string }
  period: string
  clients: { id: string; code: string; name: string; type: string; sex: string | null; dob: number | null; delivery_date: number | null; dhis2_uid: string | null }[]
  visits: { id: string; client_id: string; visited_at: number; outcome: string; rule_id: string; muac_mm: number | null; protocol_id: string }[]
  referrals: { id: string; client_id: string | null; urgency: number | null; danger_signs: string[]; destination_code: string | null; status: string; made_at: number }[]
}

const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const ALNUM = ALPHA + '0123456789'
/** A DHIS2 UID (a letter, then 10 letters or digits) derived from a seed, so the same record always gets the same UID. */
export function dhis2Uid(seed: string): string {
  const h = createHash('sha256').update(seed).digest()
  let uid = ALPHA[h[0]! % ALPHA.length]!
  for (let i = 1; i < 11; i++) uid += ALNUM[h[i]! % ALNUM.length]
  return uid
}

const HOURS_48 = 48 * 3_600_000
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** [start, end) of a YYYYMM period in UTC (Ghana keeps UTC all year). */
export function periodRange(period: string): [number, number] {
  const m = /^(\d{4})(0[1-9]|1[0-2])$/.exec(period)
  if (!m) throw new Error(`invalid period ${period}: expected YYYYMM`)
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  return [Date.UTC(y, mo, 1), Date.UTC(y, mo + 1, 1)]
}

export function buildDhis2Export(input: ExportInput, mapping: Mapping) {
  const [start, end] = periodRange(input.period)
  const orgUnit = mapping.org_units[input.facility.code]
  if (!orgUnit) throw new Error(`no DHIS2 orgUnit mapped for facility ${input.facility.code}`)
  const inPeriod = (t: number) => t >= start && t < end
  const visits = input.visits.filter((v) => inPeriod(v.visited_at))
  const referrals = input.referrals.filter((r) => inPeriod(r.made_at))

  const trackedEntities = input.clients.flatMap((c) => {
    const program = mapping.programs[c.type]
    const vs = visits.filter((v) => v.client_id === c.id)
    const rs = referrals.filter((r) => r.client_id === c.id)
    if (!program || (!vs.length && !rs.length)) return []
    const events = [
      ...vs.map((v) => ({
        at: v.visited_at,
        event: { event: dhis2Uid(`ev:${v.id}`), program: program.program, programStage: program.visit_stage, orgUnit, occurredAt: day(v.visited_at), status: 'COMPLETED',
          dataValues: [{ dataElement: mapping.data_elements.visit.summary, value: `Laafia visit (${v.protocol_id}): outcome ${v.outcome}, rule ${v.rule_id}${v.muac_mm ? `, MUAC ${v.muac_mm} mm` : ''}` }] },
      })),
      ...rs.map((r) => ({
        at: r.made_at,
        event: { event: dhis2Uid(`ev:${r.id}`), program: program.program, programStage: program.referral_stage, orgUnit, occurredAt: day(r.made_at), status: 'COMPLETED',
          dataValues: [{ dataElement: mapping.data_elements.referral.summary, value: `Laafia referral: urgency ${r.urgency ?? '-'} to ${r.destination_code ?? '-'} (${r.danger_signs.join(', ') || 'no signs'}); status ${r.status}` }] },
      })),
    ].sort((a, b) => a.at - b.at).map((e) => e.event)
    const [first, ...rest] = c.name.trim().split(/\s+/)
    const attributes = [
      { attribute: mapping.attributes.first_name, value: first ?? c.name },
      { attribute: mapping.attributes.last_name, value: rest.length ? rest[rest.length - 1]! : (first ?? c.name) },
      ...(c.sex && mapping.sex_values[c.sex] ? [{ attribute: mapping.attributes.sex, value: mapping.sex_values[c.sex]! }] : []),
      { attribute: mapping.attributes.code, value: c.code },
    ]
    const enrolledAt = events[0]!.occurredAt
    return [{
      trackedEntity: c.dhis2_uid ?? dhis2Uid(`te:${c.id}`),
      trackedEntityType: mapping.trackedEntityType,
      orgUnit,
      attributes,
      enrollments: [{ enrollment: dhis2Uid(`en:${c.id}:${program.program}`), program: program.program, orgUnit, enrolledAt, occurredAt: enrolledAt, status: 'ACTIVE', events }],
    }]
  })

  const typeOf = new Map(input.clients.map((c) => [c.id, c]))
  const anc = visits.filter((v) => typeOf.get(v.client_id)?.type === 'pregnant').length
  const pnc48 = input.clients.filter((c) => {
    const born = c.type === 'postpartum' ? c.delivery_date : c.type === 'newborn' ? c.dob : null
    return born !== null && inPeriod(born) && input.visits.some((v) => v.client_id === c.id && v.visited_at >= born && v.visited_at - born <= HOURS_48)
  }).length
  const completed = referrals.filter((r) => r.status === 'treated' || r.status === 'closed').length
  const de = mapping.aggregate.data_elements
  const dataValueSet = {
    dataSet: mapping.aggregate.data_set,
    period: input.period,
    orgUnit,
    dataValues: [
      { dataElement: de.anc_contacts, value: String(anc) },
      { dataElement: de.pnc_within_48h, value: String(pnc48) },
      { dataElement: de.referrals_made, value: String(referrals.length) },
      { dataElement: de.referrals_completed, value: String(completed) },
    ],
  }
  // Plain numbers for people: the dataValueSet carries only DHIS2 ids.
  const summary = {
    anc_contacts: anc, pnc_within_48h: pnc48, referrals_made: referrals.length, referrals_completed: completed,
    tracked_entities: trackedEntities.length, events: trackedEntities.reduce((n, t) => n + t.enrollments[0]!.events.length, 0),
  }
  return { tracker: { trackedEntities }, dataValueSet, summary }
}
