import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { SID, TODAY, activate, app, bearer, event, prisma, pullAs, pushAs, pushes, useDb } from '../../../platform/testing/helpers.ts'

useDb()

const token = (n: string) => `ExponentPushToken[${n.padEnd(12, 'x')}]`
const register = (jwt: string, t: string | null) => request(app).post('/sync/push-token').set(bearer(jwt)).send({ token: t })
const settle = () => new Promise((r) => setTimeout(r, 50))
const toHospital = { id: 'r-push-1', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_code: 'CL-0041', urgency: 3, client_type: 'newborn', danger_signs: ['convulsions'], destination_facility_id: 'fac-0003' }

describe('pushes over the internet', () => {
  it('rings the destination facility phone the moment a referral reaches the server, once', async () => {
    const hospital = await activate('F003', '0200000003')
    expect((await register(hospital, token('hospital'))).status).toBe(200)
    const cho = await activate('D001')
    pushes.length = 0
    await pushAs(cho, [{ table: 'referrals', row: toHospital }, { table: 'referral_events', row: event({ referral_id: 'r-push-1', status: 'sent' }) }])
    await settle()
    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatchObject({ to: token('hospital'), channelId: 'laafia_referrals', title: 'EMERGENCY referral coming', data: { kind: 'referral', referral_id: 'r-push-1' } })
  })

  it("tells the CHO's phone each step the facility takes, which is how it knows to hold back the SMS", async () => {
    const cho = await activate('D001')
    await register(cho, token('cho'))
    const hospital = await activate('F003', '0200000003')
    await pushAs(cho, [{ table: 'referrals', row: toHospital }])
    await settle()
    pushes.length = 0
    await pushAs(hospital, [{ table: 'referral_events', row: event({ referral_id: 'r-push-1', status: 'received', source_device_id: 'F003', device_id: 'F003', via: 'https' }) }])
    await settle()
    expect(pushes).toEqual([expect.objectContaining({ to: token('cho'), channelId: 'laafia_updates', data: { kind: 'status', referral_id: 'r-push-1', status: 'received' } })])
  })

  it('keeps push addresses on the server: another phone never pulls them, and a bad one is refused', async () => {
    const hospital = await activate('F003', '0200000003')
    await register(hospital, token('hospital'))
    const cho = await activate('D001')
    const rows = (await pullAs(cho)).body.records as { table: string; row: Record<string, unknown> }[]
    expect(rows.filter((r) => r.table === 'devices').some((r) => 'push_token' in r.row)).toBe(false)
    expect((await register(cho, 'not-a-token')).status).toBe(400)
    expect((await register(hospital, null)).status).toBe(200)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: 'F003' } })).pushToken).toBeNull()
  })

  it('moves an address to the device that registers it last, so one install is never two phones', async () => {
    const first = await activate('F003', '0200000003')
    await register(first, token('shared'))
    const second = await activate('F002', '0200000002')
    await register(second, token('shared'))
    const devices = await prisma.device.findMany({ where: { id: { in: ['F002', 'F003'] } }, select: { id: true, pushToken: true }, orderBy: { id: 'asc' } })
    expect(devices).toEqual([{ id: 'F002', pushToken: token('shared') }, { id: 'F003', pushToken: null }])
  })
})
