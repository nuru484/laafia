import { encode } from '@laafia/core'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { KEYS, SID, TODAY, activate, app, bearer, lfr, prisma, pullAs, pushAs, sms, useDb } from '../../../platform/testing/helpers.ts'

useDb()

describe('transport providers from a CHO phone', () => {
  it('accepts a CHO-pushed provider row and scopes it to the CHO facility', async () => {
    const cho = await activate('D001')
    const res = await pushAs(cho, [{ table: 'transport_providers', row: { id: 'tp-new', updated_at: TODAY, name: 'Alhassan Tricycle', phone: '0240000199', vehicle: 'tricycle', community: 'Diare' } }])
    expect(res.body).toEqual({ accepted: ['tp-new'], rejected: [] })
    expect(await prisma.transportProvider.findUniqueOrThrow({ where: { id: 'tp-new' } })).toMatchObject({ facilityId: 'fac-0001', active: true })
    const other = await activate('F002', '0200000002')
    expect((await pullAs(other)).body.records.some((r: { row: { id: string } }) => r.row.id === 'tp-new')).toBe(false)
  })

  it('registers, lists and edits providers through device endpoints', async () => {
    const cho = await activate('D001')
    const created = await request(app).post('/transport/providers').set(bearer(cho)).send({ name: 'Mba Yakubu', phone: '+233 24 000 0177', vehicle: 'motorbike', community: 'Moglaa' })
    expect(created.status).toBe(201)
    expect(created.body.provider).toMatchObject({ name: 'Mba Yakubu', phone: '0240000177', facility_id: 'fac-0001', active: true })
    const id = created.body.provider.id as string

    const list = await request(app).get('/transport/providers').set(bearer(cho))
    expect(list.body.providers.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['tp-0001', 'tp-0002', id]))

    const edited = await request(app).patch(`/transport/providers/${id}`).set(bearer(cho)).send({ active: false, vehicle: 'tricycle' })
    expect(edited.body.provider).toMatchObject({ id, active: false, vehicle: 'tricycle', name: 'Mba Yakubu' })

    const other = await activate('F002', '0200000002')
    expect((await request(app).patch(`/transport/providers/${id}`).set(bearer(other)).send({ active: true })).status).toBe(404)
    const vol = await activate('V001', '0240000002')
    expect((await request(app).post('/transport/providers').set(bearer(vol)).send({ name: 'x', phone: '0240000000' })).status).toBe(403)
  })
})

describe('online transport request', () => {
  it('records the request and texts the driver a pickup message', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: { id: 'r-1', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0001', urgency: 3, destination_facility_id: 'fac-0003' } }])
    const res = await request(app).post('/transport/requests').set(bearer(cho)).send({ referral_id: 'r-1', provider_id: 'tp-0001' })
    expect(res.status).toBe(201)
    expect(res.body.transport_request).toMatchObject({ referral_id: 'r-1', provider_id: 'tp-0001', status: 'requested', facility_id: 'fac-0001' })
    const job = await prisma.job.findFirstOrThrow()
    const payload = job.payload as { to: string; body: string }
    expect(payload.to).toBe('0240000101')
    expect(payload.body).toContain('LAAFIA pickup: URGENT')
    expect(payload.body).toContain('Savelugu Municipal Hospital')
    expect(payload.body).toContain(`Ref ${SID}`)

    // The driver's reply updates the request.
    expect((await sms('1 coming now', '+233240000101')).body).toMatchObject({ ok: true, kind: 'driver_reply', status: 'coming' })

    expect((await request(app).post('/transport/requests').set(bearer(cho)).send({ referral_id: 'nope', provider_id: 'tp-0001' })).status).toBe(404)
  })

  it('holds a scheduled pickup until 18 hours before', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: { id: 'r-2', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0001', urgency: 1, destination_facility_id: 'fac-0003' } }])
    const at = Date.now() + 3 * 86_400_000
    await request(app).post('/transport/requests').set(bearer(cho)).send({ referral_id: 'r-2', provider_id: 'tp-0001', scheduled_for: at })
    const job = await prisma.job.findFirstOrThrow()
    expect(job.runAt).toBe(at - 18 * 3_600_000)
  })
})

describe('client codes', () => {
  it('accepts device-prefixed client codes such as CL-D001003', async () => {
    const cho = await activate('D001')
    const res = await pushAs(cho, [{ table: 'clients', row: { id: 'cl-x', updated_at: TODAY, household_id: 'hh-0001', code: 'CL-D001003', type: 'pregnant', name: 'Test', edd: TODAY } }])
    expect(res.body.accepted).toEqual(['cl-x'])
    const viaSms = await sms(encode({ ...lfr, client_code: 'CL-D001003' }, KEYS.D001!))
    expect(viaSms.body).toMatchObject({ ok: true, kind: 'referral' })
    expect((await prisma.referral.findFirstOrThrow()).clientCode).toBe('CL-D001003')
  })
})
