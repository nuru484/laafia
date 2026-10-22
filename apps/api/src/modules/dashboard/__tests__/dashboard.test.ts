import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { write } from '../../../platform/db.ts'
import { SID, USERS, activate, app, deps, event, prisma, pushAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()
beforeEach(() => {
  cho = null
})

const MIN = 60_000
const DAY = 86_400_000

let cho: string | null = null
async function referral(id: string, shortId: string, dest: string, urgency: number, events: [string, number][]) {
  cho ??= await activate('D001')
  await pushAs(cho, [{ table: 'referrals', row: { id, updated_at: Date.now(), origin_device_id: 'D001', short_id: shortId, client_id: 'cl-0001', urgency, destination_facility_id: dest } }])
  await pushAs(cho, events.filter(([s]) => s === 'sent').map(([status, at]) => ({ table: 'referral_events', row: event({ referral_id: id, short_id: shortId, status, at, updated_at: at }) })))
  // Facility-side events written directly, as the facility phone would have pushed them.
  await write(prisma, (tx) => tx.referralEvent.createMany({ data: events.filter(([s]) => s !== 'sent').map(([status, at], i) => ({ id: `${id}-${i}`, referralId: id, status, at, sourceDeviceId: 'F003', via: 'local', updatedAt: at })) }))
  await write(prisma, (tx) => tx.referral.update({ where: { id }, data: { status: events.at(-1)![0] } }))
}

describe('scope from the role', () => {
  it('refuses facility staff with no facility everywhere instead of widening to the district', async () => {
    await prisma.user.update({ where: { email: USERS.hospital }, data: { facilityId: null, districtId: 'dist-sav' } })
    const { agent, csrf } = await signIn(USERS.hospital)
    for (const path of ['/dashboard/summary', '/dashboard/overview', '/referrals', '/admin/facilities']) {
      const res = await agent.get(path)
      expect([path, res.status, res.body.message]).toEqual([path, 403, 'No facility assigned'])
    }
    expect((await agent.post('/events/ticket').set(csrf).send({ facility: 'SAV-HOSP-01' })).status).toBe(403)
    expect((await agent.get('/referrals/demo')).status).toBe(403)
  })
})

describe('overview', () => {
  it('shows today by state, overdue acknowledgements, did-not-arrive, rates and stale devices', async () => {
    const now = Date.now()
    await referral('r-overdue', SID, 'fac-0003', 3, [['sent', now - 20 * MIN]]) // urgency 3 must be acknowledged within 10 min
    await referral('r-missing', 'BBBBBBBB', 'fac-0003', 3, [['sent', now - 8 * 3_600_000], ['received', now - 7.9 * 3_600_000]]) // not arrived within 6 h
    await referral('r-done', 'CCCCCCCC', 'fac-0003', 2, [['sent', now - 2 * DAY], ['received', now - 2 * DAY + 10 * MIN], ['arrived', now - 2 * DAY + 60 * MIN], ['treated', now - 2 * DAY + 90 * MIN]])
    await prisma.deviceStatus.create({ data: { deviceId: 'V001', lastSyncAt: now - 5 * DAY, appVersion: '0.4.0' } })
    await prisma.deviceStatus.create({ data: { deviceId: 'F003', lastSyncAt: now - 10 * MIN, appVersion: '0.4.2' } })

    const { agent } = await signIn(USERS.admin)
    const res = await agent.get('/dashboard/overview')
    expect(res.status).toBe(200)
    const o = res.body
    expect(o.overdue_acknowledgements.map((r: { id: string }) => r.id)).toEqual(['r-overdue'])
    expect(o.did_not_arrive.map((r: { id: string }) => r.id)).toEqual(['r-missing'])
    expect(o.completion_rate_30d).toBeCloseTo(1 / 3)
    expect(o.median_ack_minutes_30d).toBe(8)
    const stale = o.devices_not_synced_3d.map((d: { id: string }) => d.id)
    expect(stale).toContain('V001')
    expect(stale).not.toContain('F003')
    expect(stale).toContain('F001') // never synced
    expect(o.today.by_status.sent + o.today.by_status.received).toBeGreaterThanOrEqual(0)

    // Facility staff see their own facility, without device health.
    const hc = await signIn(USERS.healthCentre)
    const own = (await hc.agent.get('/dashboard/overview')).body
    expect(own.overdue_acknowledgements).toEqual([])
    expect(own.devices_not_synced_3d).toEqual([])
    expect((await request(app).get('/dashboard/overview')).status).toBe(401)
    void deps
  })

  it('records the last sync and app version of each phone', async () => {
    const jwt = await activate('D001')
    await request(app).get('/sync/pull').set({ Authorization: `Bearer ${jwt}`, 'X-App-Version': '0.4.2' })
    expect(await prisma.deviceStatus.findUniqueOrThrow({ where: { deviceId: 'D001' } })).toMatchObject({ appVersion: '0.4.2', lastSyncAt: expect.any(Number) })
    const { agent } = await signIn(USERS.admin)
    const d001 = (await agent.get('/admin/devices')).body.devices.find((d: { id: string }) => d.id === 'D001')
    expect(d001).toMatchObject({ app_version: '0.4.2', last_sync_at: expect.any(Number), facility_code: 'SAV-CHPS-01' })
  })

  it('gives facility staff their own referral history counts', async () => {
    await referral('r-x', SID, 'fac-0003', 2, [['sent', Date.now() - 60 * MIN], ['received', Date.now() - 50 * MIN]])
    const hospital = await signIn(USERS.hospital)
    const s = (await hospital.agent.get('/dashboard/summary')).body
    expect(s).toMatchObject({ district: null, facility: { code: 'SAV-HOSP-01' }, total: 1, by_status: { received: 1 } })
    const hc = await signIn(USERS.healthCentre)
    expect((await hc.agent.get('/dashboard/summary')).body.total).toBe(0)
  })
})
