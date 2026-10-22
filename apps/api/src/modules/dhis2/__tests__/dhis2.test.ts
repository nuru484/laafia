import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDhis2Export, dhis2Uid, loadMapping, type ExportInput } from '../dhis2.export.ts'
import { env } from '../../../config/env.ts'
import { ADMIN, USERS, activate, app, event, pushAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

const DAY = 86_400_000
const OCT = Date.UTC(2026, 9, 1)
const mapping = loadMapping()

const fixture: ExportInput = {
  facility: { id: 'fac-0001', code: 'SAV-CHPS-01' },
  period: '202610',
  clients: [
    { id: 'cl-1', code: 'CL-0001', name: 'Amina Alhassan', type: 'postpartum', sex: 'f', dob: null, delivery_date: OCT, dhis2_uid: null },
    { id: 'cl-2', code: 'CL-0002', name: 'Wumbei Mahama', type: 'child', sex: 'm', dob: OCT - 400 * DAY, delivery_date: null, dhis2_uid: 'TEexisting1' },
    { id: 'cl-3', code: 'CL-0003', name: 'Zenabu Issah', type: 'pregnant', sex: 'f', dob: null, delivery_date: null, dhis2_uid: null },
    { id: 'cl-4', code: 'CL-0004', name: 'Not This Month', type: 'pregnant', sex: 'f', dob: null, delivery_date: null, dhis2_uid: null },
  ],
  visits: [
    { id: 'v-1', client_id: 'cl-1', visited_at: OCT + 3 * DAY, outcome: 'refer', rule_id: 'M-R1', muac_mm: null, protocol_id: 'maternal' },
    { id: 'v-2', client_id: 'cl-2', visited_at: OCT + 10 * DAY, outcome: 'followup', rule_id: 'C-F1', muac_mm: 118, protocol_id: 'child' },
    { id: 'v-3', client_id: 'cl-3', visited_at: OCT + 12 * DAY, outcome: 'routine', rule_id: 'M-DEFAULT', muac_mm: null, protocol_id: 'maternal' },
    { id: 'v-4', client_id: 'cl-3', visited_at: OCT + 20 * DAY, outcome: 'routine', rule_id: 'M-DEFAULT', muac_mm: null, protocol_id: 'maternal' },
    { id: 'v-5', client_id: 'cl-4', visited_at: OCT - 40 * DAY, outcome: 'routine', rule_id: 'M-DEFAULT', muac_mm: null, protocol_id: 'maternal' },
  ],
  referrals: [
    { id: 'r-1', client_id: 'cl-1', urgency: 3, danger_signs: ['bleeding'], destination_code: 'SAV-HOSP-01', status: 'treated', made_at: OCT + 3 * DAY },
    { id: 'r-2', client_id: 'cl-2', urgency: 2, danger_signs: ['fast_breathing'], destination_code: 'PTA-HC-01', status: 'received', made_at: OCT + 10 * DAY },
  ],
}

describe('buildDhis2Export (pure)', () => {
  it('builds tracked entities with enrollments and events for the period', () => {
    const out = buildDhis2Export(fixture, mapping)
    const tes = out.tracker.trackedEntities
    expect(tes.map((t) => t.trackedEntity)).toEqual([dhis2Uid('te:cl-1'), 'TEexisting1', dhis2Uid('te:cl-3')]) // cl-4 had nothing this month
    expect(tes.every((t) => /^[A-Za-z][A-Za-z0-9]{10}$/.test(t.trackedEntity))).toBe(true)
    const amina = tes[0]!
    expect(amina).toMatchObject({ trackedEntityType: mapping.trackedEntityType, orgUnit: 'DiszpKrYNg8' })
    expect(amina.attributes).toEqual(expect.arrayContaining([
      { attribute: mapping.attributes.first_name, value: 'Amina' },
      { attribute: mapping.attributes.last_name, value: 'Alhassan' },
      { attribute: mapping.attributes.sex, value: 'Female' },
      { attribute: mapping.attributes.code, value: 'CL-0001' },
    ]))
    const events = amina.enrollments[0]!.events
    expect(events).toHaveLength(2) // the visit and the referral
    expect(events.map((e) => e.occurredAt)).toEqual(['2026-10-04', '2026-10-04'])
    expect(events[1]!.dataValues[0]!.value).toContain('urgency 3')
    expect(events[1]!.dataValues[0]!.value).toContain('SAV-HOSP-01')
    // Same input, same UIDs: re-exporting updates instead of duplicating.
    expect(buildDhis2Export(fixture, mapping)).toEqual(out)
  })

  it('summarises the month as a dataValueSet', () => {
    const { dataValueSet } = buildDhis2Export(fixture, mapping)
    expect(dataValueSet).toMatchObject({ dataSet: mapping.aggregate.data_set, period: '202610', orgUnit: 'DiszpKrYNg8' })
    const v = Object.fromEntries(dataValueSet.dataValues.map((d) => [d.dataElement, d.value]))
    const de = mapping.aggregate.data_elements
    expect(v[de.anc_contacts]).toBe('2') // two ANC visits for cl-3 in October
    expect(v[de.pnc_within_48h]).toBe('0') // cl-1 delivered 1 Oct, first visit 4 Oct is after 48 h
    expect(v[de.referrals_made]).toBe('2')
    expect(v[de.referrals_completed]).toBe('1')
  })

  it('rejects a bad period and an unmapped facility', () => {
    expect(() => buildDhis2Export({ ...fixture, period: '2026-10' }, mapping)).toThrow(/period/)
    expect(() => buildDhis2Export({ ...fixture, facility: { id: 'x', code: 'NOPE-01' } }, mapping)).toThrow(/orgUnit/)
  })
})

describe('/export/dhis2', () => {
  useDb()
  afterEach(() => {
    vi.restoreAllMocks()
    env.DHIS2_BASE_URL = undefined
    env.DHIS2_USERNAME = undefined
    env.DHIS2_PASSWORD = undefined
  })

  it('exports seeded records for a facility and month (admin only)', async () => {
    const period = new Date().toISOString().slice(0, 7).replace('-', '')
    expect((await request(app).get(`/export/dhis2?facility=SAV-CHPS-01&period=${period}`)).status).toBe(401)
    const res = await request(app).get(`/export/dhis2?facility=SAV-CHPS-01&period=${period}`).set(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.tracker.trackedEntities.length).toBeGreaterThan(0)
    expect(res.body.dataValueSet.period).toBe(period)
    expect((await request(app).get('/export/dhis2?facility=SAV-CHPS-01&period=26').set(ADMIN)).status).toBe(400)
  })

  it('pushes to DHIS2 as a dry run by default', async () => {
    env.DHIS2_BASE_URL = 'https://dhis2.example.org'
    env.DHIS2_USERNAME = 'u'
    env.DHIS2_PASSWORD = 'p'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/api/tracker')
        ? new Response(JSON.stringify({ status: 'OK', stats: { created: 3, updated: 0, ignored: 0 }, validationReport: { errorReports: [] } }))
        : new Response(JSON.stringify({ status: 'SUCCESS', importCount: { imported: 4, updated: 0, ignored: 0 }, conflicts: [] })))
    const jwt = await activate('D001')
    await pushAs(jwt, [{ table: 'referral_events', row: event({}) }])
    const period = new Date().toISOString().slice(0, 7).replace('-', '')
    const res = await request(app).post('/export/dhis2').set(ADMIN).send({ facility: 'SAV-CHPS-01', period })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ dry_run: true, tracker: { status: 'OK', stats: { created: 3 } }, aggregate: { status: 'SUCCESS' } })
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('/api/tracker?')
    expect(urls[0]).toContain('dryRun=true')
    expect(urls[0]).toContain('importStrategy=CREATE_AND_UPDATE')
    expect(urls[1]).toContain('/api/dataValueSets?')
    expect(urls[1]).toContain('dryRun=true')
  })

  it('keeps an export history and shows which periods are not exported yet', async () => {
    env.DHIS2_BASE_URL = 'https://dhis2.example.org'
    env.DHIS2_USERNAME = 'u'
    env.DHIS2_PASSWORD = 'p'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('/api/tracker')
        ? new Response(JSON.stringify({ status: 'OK', stats: { created: 1 } }))
        : new Response(JSON.stringify({ status: 'SUCCESS', importCount: { imported: 4 } })))
    const d = new Date()
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
    const period = `${last.getUTCFullYear()}${String(last.getUTCMonth() + 1).padStart(2, '0')}`
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await agent.post('/export/dhis2').set(csrf).send({ facility: 'SAV-CHPS-01', period })).body).toMatchObject({ dry_run: true, status: 'ok', run_id: expect.any(String) })
    let pending = (await agent.get('/export/dhis2/pending?facility=SAV-CHPS-01')).body
    expect(pending.periods[0]).toMatchObject({ period, exported: false, last_run: { dry_run: true, actor: 'Alhassan Yakubu' } })
    await agent.post('/export/dhis2').set(csrf).send({ facility: 'SAV-CHPS-01', period, dry_run: false })
    pending = (await agent.get('/export/dhis2/pending?facility=SAV-CHPS-01')).body
    expect(pending.periods).toHaveLength(12)
    expect(pending.periods[0]).toMatchObject({ period, exported: true })
    expect(pending.periods[1].exported).toBe(false)
    const history = (await agent.get('/export/dhis2/history?facility=SAV-CHPS-01')).body.runs
    expect(history.map((r: { dry_run: boolean }) => r.dry_run)).toEqual([false, true])
    const auditRows = (await agent.get('/admin/audit?target_type=export')).body.events
    expect(auditRows).toHaveLength(2)
    expect(auditRows[0]).toMatchObject({ action: 'export.push', actor_name: 'Alhassan Yakubu' })

    // Outside the district, and other roles, are refused.
    expect((await agent.get('/export/dhis2/history?facility=TTH-HOSP-01')).status).toBe(403)
    const staff = await signIn(USERS.hospital)
    expect((await staff.agent.get('/export/dhis2/history?facility=SAV-HOSP-01')).status).toBe(403)
  })

  it.skipIf(!process.env.DHIS2_PLAY)('dry-runs the export against the public DHIS2 play demo', async () => {
    env.DHIS2_BASE_URL = 'https://play.im.dhis2.org/dev'
    env.DHIS2_USERNAME = 'admin'
    env.DHIS2_PASSWORD = 'district'
    const period = new Date().toISOString().slice(0, 7).replace('-', '')
    const res = await request(app).post('/export/dhis2').set(ADMIN).send({ facility: 'SAV-CHPS-01', period, dry_run: true })
    expect(res.status).toBe(200)
    expect(res.body.tracker.status).toBeDefined()
    expect(res.body.aggregate.status).toBeDefined()
    console.log(JSON.stringify(res.body).slice(0, 1500))
  }, 120_000)
})
