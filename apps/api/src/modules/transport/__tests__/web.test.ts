import { describe, expect, it } from 'vitest'
import { SID, TODAY, USERS, activate, prisma, pushAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()

describe('transport from the dashboard', () => {
  it('lets facility staff arrange a pickup for a referral at their facility, and refuses others', async () => {
    const cho = await activate('D001')
    const client = await prisma.client.findUniqueOrThrow({ where: { id: 'cl-0001' } })
    const home = await prisma.household.findUniqueOrThrow({ where: { id: client.householdId } })
    await pushAs(cho, [{ table: 'referrals', row: { id: 'r-1', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0001', urgency: 3, destination_facility_id: 'fac-0003' } }])
    const hospital = await signIn(USERS.hospital)
    const options = (await hospital.agent.get('/referrals/r-1/transport/options')).body
    expect(options.community).toBe(home.community)
    expect(options.providers.length).toBeGreaterThan(0)
    const provider = options.providers[0]
    const res = await hospital.agent.post('/referrals/r-1/transport').set(hospital.csrf).send({ provider_id: provider.id })
    expect(res.status).toBe(201)
    expect(res.body.transport_request).toMatchObject({ referral_id: 'r-1', provider_id: provider.id, status: 'requested', facility_id: 'fac-0001', device_id: 'web:usr-0003' })
    const job = await prisma.job.findFirstOrThrow({ where: { purpose: 'driver' } })
    expect((job.payload as { body: string }).body).toContain('Call CHO 0200000003') // the hospital's number calls back
    const view = (await hospital.agent.get('/referrals/r-1')).body.referral
    expect(view.transport[0]).toMatchObject({ provider_name: provider.name, status: 'requested' })

    const hc = await signIn(USERS.healthCentre)
    expect((await hc.agent.get('/referrals/r-1/transport/options')).status).toBe(404)
    expect((await hc.agent.post('/referrals/r-1/transport').set(hc.csrf).send({ provider_id: provider.id })).status).toBe(404)
    expect((await (await signIn(USERS.supervisor)).agent.get('/referrals/r-1/transport/options')).status).toBe(403)
  })
})
