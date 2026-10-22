import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import writeXlsxFile from 'write-excel-file/node'
import { env } from '../../../config/env.ts'
import { ADMIN, activate, app, prisma, pullAs, useDb } from '../../../platform/testing/helpers.ts'

useDb()
afterEach(() => {
  vi.restoreAllMocks()
  env.DHIS2_BASE_URL = undefined
  env.DHIS2_USERNAME = undefined
  env.DHIS2_PASSWORD = undefined
})

const ANC_TEMPLATE = {
  name: 'GHS ANC register',
  source: 'tabular',
  mapping: { name: 'Client Name', community: 'Community', head_name: 'Household Head', landmark: 'Landmark', edd: 'EDD', parity: 'Parity', nhis_active: 'NHIS', sex: 'Sex' },
  constants: { type: 'pregnant' },
}
const createTemplate = async (t: object) => {
  const res = await request(app).post('/admin/import/templates').set(ADMIN).send(t)
  expect(res.status).toBe(201)
  return res.body.template.id as string
}
const previewFile = (templateId: string, file: Buffer, name: string) =>
  request(app).post('/admin/import/preview').set(ADMIN).field('template_id', templateId).field('facility_code', 'SAV-CHPS-01').attach('file', file, name)

async function seededPregnant() {
  const c = await prisma.client.findFirstOrThrow({ where: { type: 'pregnant' } })
  const h = await prisma.household.findUniqueOrThrow({ where: { id: c.householdId } })
  return { name: c.name, community: h.community, head: h.headName }
}

describe('register import (CSV / XLSX)', () => {
  it('previews as a dry run with row errors and duplicates, commits in one transaction, and undoes', async () => {
    const existing = await seededPregnant()
    const csv = [
      'Serial,Client Name,Community,Household Head,Landmark,EDD,Parity,NHIS,Sex',
      '1,Asana Iddrisu,Kanshegu,Mba Iddrisu,"near the borehole, east side",15/02/2027,1,Yes,F',
      '2,Zenabu Fuseini,Moglaa,Naa Fuseini,,2027-03-01,0,No,female',
      '3,,Diare,Naa X,,2027-01-01,0,No,F',
      '4,Bad Date,Diare,Naa Y,,31/31/2027,0,No,F',
      '5,Asana Iddrisu,Kanshegu,Mba Iddrisu,"near the borehole, east side",15/02/2027,1,Yes,F',
      `6,${existing.name},${existing.community},${existing.head},,2027-02-01,2,No,F`,
    ].join('\r\n')
    const templateId = await createTemplate(ANC_TEMPLATE)
    const before = await prisma.client.count()

    const prev = await previewFile(templateId, Buffer.from('﻿' + csv), 'anc.csv')
    expect(prev.status).toBe(201)
    const batch = prev.body.batch
    expect(batch).toMatchObject({ status: 'preview', source: 'csv', counts: { rows: 6, valid: 2, errors: 2, duplicates: 2 } })
    expect(batch.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, kind: 'error', field: 'name' }),
      expect.objectContaining({ row: 4, kind: 'error', field: 'edd' }),
      expect.objectContaining({ row: 5, kind: 'duplicate', message: expect.stringContaining('row 1') }),
      expect.objectContaining({ row: 6, kind: 'duplicate', match_id: expect.any(String) }),
    ]))
    expect(batch.sample[0]).toMatchObject({ row: 1, household: { landmark: 'near the borehole, east side' }, client: { name: 'Asana Iddrisu', type: 'pregnant', sex: 'f', edd: Date.UTC(2027, 1, 15), parity: 1, nhis_active: true } })
    expect(await prisma.client.count()).toBe(before) // dry run wrote nothing

    const jwt = await activate('D001')
    const { body: first } = await pullAs(jwt)
    const commit = await request(app).post(`/admin/import/batches/${batch.id}/commit`).set(ADMIN)
    expect(commit.status).toBe(200)
    expect(commit.body.batch).toMatchObject({ status: 'committed', counts: { clients_created: 2 } })
    const imported = await prisma.client.findMany({ where: { code: { startsWith: 'RG-' } } })
    expect(imported.map((c) => c.name).sort()).toEqual(['Asana Iddrisu', 'Zenabu Fuseini'])
    expect(imported.every((c) => c.facilityId === 'fac-0001')).toBe(true)
    const pulled = await pullAs(jwt, first.cursor)
    expect(pulled.body.records.filter((r: { table: string }) => r.table === 'clients')).toHaveLength(2)
    expect((await request(app).post(`/admin/import/batches/${batch.id}/commit`).set(ADMIN)).status).toBe(409)

    const undo = await request(app).post(`/admin/import/batches/${batch.id}/undo`).set(ADMIN)
    expect(undo.status).toBe(200)
    expect(undo.body).toMatchObject({ batch: { status: 'undone' }, undone: { clients: 2 }, kept: { clients: 0 } })
    expect(await prisma.client.count({ where: { code: { startsWith: 'RG-' }, deleted: false } })).toBe(0)
    expect((await request(app).post(`/admin/import/batches/${batch.id}/undo`).set(ADMIN)).status).toBe(409)
  })

  it('reads XLSX with the same template, including date cells', async () => {
    const templateId = await createTemplate(ANC_TEMPLATE)
    const header = ['Client Name', 'Community', 'Household Head', 'EDD', 'Parity'].map((value) => ({ value }))
    const xlsx = await writeXlsxFile([
      header,
      [{ value: 'Hawa Abukari' }, { value: 'Diare' }, { value: 'Naa Abukari' }, { value: new Date(Date.UTC(2027, 0, 9)), type: Date, format: 'dd/mm/yyyy' }, { value: 2, type: Number }],
    ]).toBuffer()
    const prev = await previewFile(templateId, xlsx, 'anc.xlsx')
    expect(prev.status).toBe(201)
    expect(prev.body.batch).toMatchObject({ source: 'xlsx', counts: { rows: 1, valid: 1 } })
    expect(prev.body.batch.sample[0].client).toMatchObject({ name: 'Hawa Abukari', edd: Date.UTC(2027, 0, 9), parity: 2 })
  })

  it('rejects an upload that is neither CSV nor XLSX', async () => {
    const templateId = await createTemplate(ANC_TEMPLATE)
    expect((await previewFile(templateId, Buffer.from('%PDF-1.7'), 'register.pdf')).status).toBe(415)
  })
})

// DHIS2 Tracker fixtures in the 2.41+ shape (trackedEntities + pager.nextPage).
const te = (uid: string, first: string, last: string, dob: string, village: string) => ({
  trackedEntity: uid, orgUnit: 'OU1',
  attributes: [
    { attribute: 'w75KJ2mc4zz', displayName: 'First name', value: first },
    { attribute: 'zDhUuAYrxNC', displayName: 'Last name', value: last },
    { attribute: 'cejWyOfXge6', displayName: 'Gender', value: 'Female' },
    { attribute: 'iESIqZ0R0R0', displayName: 'Date of birth', value: dob },
    { attribute: 'VILLAGE0001', displayName: 'Village', value: village },
  ],
  enrollments: [{ enrolledAt: '2026-01-01T00:00:00.000', program: 'IpHINAT79UW' }],
})
const DHIS2_TEMPLATE = {
  name: 'DHIS2 child programme',
  source: 'dhis2',
  mapping: { name: 'First name+Last name', sex: 'cejWyOfXge6', dob: 'Date of birth', community: 'Village' },
  constants: { type: 'child' },
}

describe('DHIS2 Tracker import', () => {
  it('returns 503 when DHIS2 is not configured', async () => {
    const templateId = await createTemplate(DHIS2_TEMPLATE)
    const res = await request(app).post('/admin/import/dhis2/preview').set(ADMIN).send({ template_id: templateId, facility_code: 'SAV-CHPS-01', org_unit: 'OU1', program: 'IpHINAT79UW' })
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('dhis2_unconfigured')
  })

  it('pages through trackedEntities, maps attributes, and dedupes on the DHIS2 UID', async () => {
    env.DHIS2_BASE_URL = 'https://dhis2.example.org'
    env.DHIS2_USERNAME = 'importer'
    env.DHIS2_PASSWORD = 'secret'
    const pages: Record<string, object> = {
      '1': { pager: { page: 1, pageSize: 2, nextPage: 'https://dhis2.example.org/api/tracker/trackedEntities?page=2' }, trackedEntities: [te('TEaaaaaaaa1', 'Wumpini', 'Iddrisu', '2024-05-01', 'Kanshegu'), te('TEaaaaaaaa2', 'Tahiru', 'Osman', '2023-11-20', 'Moglaa')] },
      '2': { pager: { page: 2, pageSize: 2 }, trackedEntities: [te('TEaaaaaaaa3', 'Nasara', 'Issah', '2025-02-14', 'Diare')] },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input))
      return new Response(JSON.stringify(pages[url.searchParams.get('page') ?? '1']), { status: 200 })
    })
    const templateId = await createTemplate(DHIS2_TEMPLATE)
    const body = { template_id: templateId, facility_code: 'SAV-CHPS-01', org_unit: 'OU1', program: 'IpHINAT79UW' }
    const prev = await request(app).post('/admin/import/dhis2/preview').set(ADMIN).send(body)
    expect(prev.status).toBe(201)
    expect(prev.body.batch).toMatchObject({ source: 'dhis2', counts: { rows: 3, valid: 3 } })
    expect(prev.body.batch.sample[0].client).toMatchObject({ name: 'Wumpini Iddrisu', sex: 'f', dob: Date.UTC(2024, 4, 1), dhis2_uid: 'TEaaaaaaaa1' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/tracker/trackedEntities?')
    expect(String(url)).toContain('orgUnits=OU1')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Basic ' + Buffer.from('importer:secret').toString('base64'))

    expect((await request(app).post(`/admin/import/batches/${prev.body.batch.id}/commit`).set(ADMIN)).status).toBe(200)
    const again = await request(app).post('/admin/import/dhis2/preview').set(ADMIN).send(body)
    expect(again.body.batch.counts).toMatchObject({ rows: 3, valid: 0, duplicates: 3 })
    expect(again.body.batch.issues[0].message).toContain('DHIS2 UID')
  })

  it.skipIf(!process.env.DHIS2_PLAY)('pulls from the public DHIS2 play demo', async () => {
    env.DHIS2_BASE_URL = 'https://play.im.dhis2.org/dev'
    env.DHIS2_USERNAME = 'admin'
    env.DHIS2_PASSWORD = 'district'
    const templateId = await createTemplate({ ...DHIS2_TEMPLATE, mapping: { name: 'First name+Last name', sex: 'Gender', dob: '@enrolledAt' }, constants: { type: 'child', community: 'Ngelehun' } })
    const res = await request(app).post('/admin/import/dhis2/preview').set(ADMIN)
      .send({ template_id: templateId, facility_code: 'SAV-CHPS-01', org_unit: 'DiszpKrYNg8', program: 'IpHINAT79UW', max_pages: 2 })
    expect(res.status).toBe(201)
    expect(res.body.batch.counts.rows).toBeGreaterThan(0)
    expect(res.body.batch.sample[0].client.dhis2_uid).toMatch(/^[A-Za-z0-9]{11}$/)
  }, 60_000)
})
