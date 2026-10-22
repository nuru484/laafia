import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ADMIN, SID, TODAY, activate, app, bearer, event, pullAs, pushAs, useDb } from '../../../platform/testing/helpers.ts'

useDb()

const ref = (over: Record<string, unknown>) => ({
  id: 'r-root', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_code: 'CL-0041', urgency: 3,
  client_type: 'postpartum', danger_signs: ['bleeding'], destination_facility_id: 'fac-0001', ...over,
})
type Row = { id: string; status: string }

describe('refer onward chain', () => {
  it('links an onward referral to its parent and shows the hop on the parent', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: ref({}) }])
    const chps = await activate('F001', '0200000001')
    await pushAs(chps, [{ table: 'referral_events', row: event({ referral_id: 'r-root', status: 'received', source_device_id: 'F001' }) }])
    const onward = await pushAs(chps, [
      { table: 'referrals', row: ref({ id: 'r-onward', origin_device_id: 'F001', short_id: 'BBBBBBBB', destination_facility_id: 'fac-0003', parent_referral_id: 'r-root' }) },
      { table: 'referral_events', row: event({ referral_id: 'r-onward', origin_device_id: 'F001', short_id: 'BBBBBBBB', status: 'sent', source_device_id: 'F001' }) },
    ])
    expect(onward.body.rejected).toEqual([])
    const hosp = await activate('F003', '0200000003')
    await pushAs(hosp, [{ table: 'referral_events', row: event({ referral_id: 'r-onward', origin_device_id: 'F001', short_id: 'BBBBBBBB', status: 'arrived', source_device_id: 'F003' }) }])

    const res = await request(app).get('/referrals/r-root').set(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.referral).toMatchObject({ id: 'r-root', status: 'received', onward_referral_id: 'r-onward', onward_status: 'arrived' })
    expect(res.body.chain.map((r: Row) => [r.id, r.status])).toEqual([['r-root', 'received'], ['r-onward', 'arrived']])
    expect(res.body.chain[1]).toMatchObject({ parent_referral_id: 'r-root' })
    const leaf = await request(app).get('/referrals/r-onward').set(bearer(hosp))
    expect(leaf.body.chain.map((r: Row) => r.id)).toEqual(['r-root', 'r-onward'])

    // The CHO sees the hop on its own referral after a pull.
    const pulled = await pullAs(cho)
    const root = pulled.body.records.find((r: { table: string; row: { id: string } }) => r.table === 'referrals' && r.row.id === 'r-root')
    expect(root.row).toMatchObject({ onward_referral_id: 'r-onward', onward_status: 'arrived' })
  })

  it('refuses an onward referral from a device that may not act on the parent', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: ref({}) }])
    const other = await activate('F002', '0200000002')
    const res = await pushAs(other, [{ table: 'referrals', row: ref({ id: 'r-x', origin_device_id: 'F002', short_id: 'CCCCCCCC', parent_referral_id: 'r-root' }) }])
    expect(res.body.rejected[0].reason).toBe('forbidden')
    const unknown = await pushAs(other, [{ table: 'referrals', row: ref({ id: 'r-y', origin_device_id: 'F002', short_id: 'DDDDDDDD', parent_referral_id: 'nope' }) }])
    expect(unknown.body.rejected[0].reason).toBe('unknown_referral')
  })

  it('refuses CHO and volunteer devices on the dashboard chain endpoint', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: ref({}) }])
    const created = await request(app).post('/admin/devices').set(ADMIN).send({ id: 'D009', role: 'cho', user_name: 'Other CHO', facility_code: 'SAV-CHPS-01' })
    const otherCho = (await request(app).post('/auth/activate').send({ activation_code: created.body.activation_code, phone_number: '0240000009' })).body.jwt as string
    const volunteer = await activate('V001', '0240000002')
    expect((await request(app).get('/referrals/r-root').set(bearer(otherCho))).status).toBe(403)
    expect((await request(app).get('/referrals/r-root').set(bearer(volunteer))).status).toBe(403)
  })

  it('hides a chain from devices outside it', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: ref({}) }])
    const other = await activate('F002', '0200000002')
    expect((await request(app).get('/referrals/r-root').set(bearer(other))).status).toBe(404)
    expect((await request(app).get('/referrals/r-root').set(bearer(cho))).status).toBe(200)
    expect((await request(app).get('/referrals/nope').set(ADMIN)).status).toBe(404)
  })
})
