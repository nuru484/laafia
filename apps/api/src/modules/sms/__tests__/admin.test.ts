import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, type Env } from '../../../config/env.ts'
import { runJobs } from '../../../platform/jobs/worker.ts'
import { createSmsGateway } from '../../../platform/sms-gateway.ts'
import { SID, TODAY, USERS, activate, app, deps, prisma, pushAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()
afterEach(() => vi.restoreAllMocks())

const quiet = { info() {}, warn() {}, error() {} }

describe('SMS gateway panel', () => {
  it('reads the Frog balance the way dms-backend does', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'SUCCESS', message: 'ok', data: { bundles: { SMS: 1250, VOICE: 3 }, cashbalance: 42.5 } })))
    const gw = createSmsGateway({ ...env, FROG_API_KEY: 'k', FROG_USERNAME: 'u' } as Env, quiet)
    expect(await gw.getBalance()).toEqual({ smsUnits: 1250, cash: 42.5 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://frogapi.wigal.com.gh/api/v3/balance')
    expect(init!.headers).toMatchObject({ 'API-KEY': 'k', USERNAME: 'u' })
    expect(await createSmsGateway({ ...env, FROG_API_KEY: undefined } as Env, quiet).getBalance()).toBeNull()
  })

  it('reports an unconfigured gateway without an error, and a configured one', async () => {
    const { agent } = await signIn(USERS.admin)
    expect((await agent.get('/admin/sms/balance')).body).toEqual({ configured: false, balance: null, currency: null, sms_units: null })
    const original = deps.sms
    deps.sms = { ...original, getBalance: async () => ({ smsUnits: 900, cash: 18 }) }
    try {
      expect((await agent.get('/admin/sms/balance')).body).toEqual({ configured: true, balance: 18, currency: 'GHS', sms_units: 900 })
      deps.sms = { ...original, getBalance: async () => { throw new Error('down') } }
      expect((await agent.get('/admin/sms/balance')).body.code).toBe('sms_balance_unavailable')
    } finally {
      deps.sms = original
    }
  })

  it('lists server SMS with masked numbers and delivery status, never bodies, scoped to the district', async () => {
    const cho = await activate('D001')
    // To Tamale Teaching Hospital (no phone in facility mode): the server acknowledges to the CHO.
    await pushAs(cho, [{ table: 'referrals', row: { id: 'r-tth', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, urgency: 3, destination_facility_id: 'fac-0004' } }])
    await runJobs({ ...deps, sms: { send: async () => {}, getBalance: async () => null } })
    await prisma.job.updateMany({ data: { deliveryStatus: 'delivered', deliveredAt: Date.now() } })

    const { agent } = await signIn(USERS.admin)
    const log = (await agent.get('/admin/sms/log?limit=10')).body
    expect(log.messages).toHaveLength(1)
    expect(log.messages[0]).toMatchObject({ to_masked: '*******001', kind: 'ack', status: 'delivered', attempts: 1, error: null })
    expect(JSON.stringify(log)).not.toContain('LFS|')
    expect(JSON.stringify(log)).not.toContain('0240000001')
    expect(log.next_before).toBeNull()

    // Another district's admin token view still works; staff and supervisors are refused.
    expect((await request(app).get('/admin/sms/log').set({ 'x-admin-token': 'test-admin-token' })).body.messages).toHaveLength(1)
    expect((await (await signIn(USERS.hospital)).agent.get('/admin/sms/log')).status).toBe(403)
    expect((await (await signIn(USERS.supervisor)).agent.get('/admin/sms/balance')).status).toBe(403)
  })
})
