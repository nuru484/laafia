import { encode } from '@laafia/core'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env, type Env } from '../../../config/env.ts'
import { runJobs } from '../../../platform/jobs/worker.ts'
import { createSmsGateway } from '../../../platform/sms-gateway.ts'
import { KEYS, SID, TODAY, activate, app, deps, lfr, prisma, pushAs, sms, useDb } from '../../../platform/testing/helpers.ts'

useDb()
afterEach(() => {
  vi.restoreAllMocks()
  env.SMS_CALLBACK_SECRET = undefined
})

const quiet = { info() {}, warn() {}, error() {} }

describe('Frog gateway', () => {
  it('sends with the dms-backend call shape and treats ACCEPTD as success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ACCEPTD', message: 'ok' })))
    const gw = createSmsGateway({ ...env, FROG_API_KEY: 'k', FROG_USERNAME: 'u', FROG_SENDER_ID: 'Laafia' } as Env, quiet)
    await gw.send('0240000001', 'LFS|1|F003|D001|AAAAAAAA|R|SIGSIGSI', 'LF_7_1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://frogapi.wigal.com.gh/api/v3/sms/send')
    expect(init!.headers).toMatchObject({ 'API-KEY': 'k', USERNAME: 'u' })
    expect(JSON.parse(String(init!.body))).toEqual({ senderid: 'Laafia', destinations: [{ destination: '0240000001', msgid: 'LF_7_1' }], message: 'LFS|1|F003|D001|AAAAAAAA|R|SIGSIGSI', smstype: 'text' })

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'REJECTD', message: 'insufficient balance' }), { status: 200 }))
    await expect(gw.send('0240000001', 'x', 'LF_8_1')).rejects.toThrow(/REJECTD/)
  })

  it('logs only a masked number and the length when Frog is not configured', async () => {
    const lines: Record<string, unknown>[] = []
    const gw = createSmsGateway({ ...env, FROG_API_KEY: undefined } as Env, { ...quiet, info: (_m, x) => void lines.push(x ?? {}) })
    await gw.send('0240000001', 'LFS|1|secret body', 'LF_1_1')
    expect(lines[0]).toEqual({ to: '*******001', length: 17, msgid: 'LF_1_1' })
  })
})

describe('server sends only as the fallback path', () => {
  it('acknowledges a pushed referral only when the destination has no phone in facility mode', async () => {
    const jwt = await activate('D001')
    const row = (id: string, shortId: string, dest: string) => ({ table: 'referrals', row: { id, updated_at: TODAY, origin_device_id: 'D001', short_id: shortId, urgency: 3, destination_facility_id: dest } })
    await pushAs(jwt, [row('r-hosp', SID, 'fac-0003')])
    expect(await prisma.job.count()).toBe(0)
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: 'r-hosp' } })).status).toBe('created')
    await pushAs(jwt, [row('r-tth', 'BBBBBBBB', 'fac-0004')])
    expect(await prisma.job.count()).toBe(1)
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: 'r-tth' } })).status).toBe('received')
  })

  it('does not acknowledge an inbound LFR for a facility whose phone will', async () => {
    expect((await sms(encode(lfr, KEYS.D001!))).body).toMatchObject({ ok: true, kind: 'referral' })
    expect(await prisma.job.count()).toBe(0)
  })
})

describe('Frog delivery receipts', () => {
  it('fails closed without SMS_CALLBACK_SECRET and checks the token', async () => {
    expect((await request(app).post('/sms/delivery').send([])).status).toBe(401)
    env.SMS_CALLBACK_SECRET = 'callback-secret-callback-secret'
    expect((await request(app).post('/sms/delivery?token=nope').send([])).status).toBe(401)
    expect((await request(app).post('/sms/delivery').set('x-callback-token', 'callback-secret-callback-secret').send([])).status).toBe(200)
  })

  it('applies receipts by the msgid the worker handed Frog, skipping bad ones', async () => {
    env.SMS_CALLBACK_SECRET = 'callback-secret-callback-secret'
    const jwt = await activate('D001')
    await pushAs(jwt, [{ table: 'referrals', row: { id: 'r-tth', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, urgency: 3, destination_facility_id: 'fac-0004' } }])
    const sent: string[] = []
    await runJobs({ ...deps, sms: { send: async (_to, _body, msgid) => void sent.push(msgid) } })
    expect(sent).toHaveLength(1)
    const msgid = sent[0]!
    expect(msgid).toMatch(/^LF_\d+_\d+$/)

    // Frog posts arrays or index-keyed objects.
    const res = await request(app).post(`/sms/delivery?token=callback-secret-callback-secret`)
      .send({ 0: { msgid, status: 'DELIVRD', reason: 'Delivered', destination: '233240000001', statusdate: '2026-10-22 10:00:00' }, 1: { msgid: 'nope', status: 'DELIVRD' }, 2: { bad: true } })
    expect(res.body).toEqual({ received: 3, applied: 1 })
    const job = await prisma.job.findFirstOrThrow()
    expect(job).toMatchObject({ status: 'sent', deliveryStatus: 'delivered', deliveryReason: 'Delivered' })
    expect(job.deliveredAt).toEqual(expect.any(Number))
  })
})
