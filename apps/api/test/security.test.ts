import { encode } from '@laafia/core'
import { spawnSync } from 'node:child_process'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { db } from '../src/db.ts'
import { env } from '../src/env.ts'
import { referrals } from '../src/schema.ts'
import { ADMIN, KEYS, SID, TODAY, activate, app, bearer, event, lfr, pushAs, sms, useDb } from './helpers.ts'

useDb()

const referralRow = (over: Record<string, unknown> = {}) => ({
  id: 'r-spoof', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_code: 'CL-0041', urgency: 3,
  client_type: 'postpartum', danger_signs: ['bleeding'], destination_facility_id: 'fac-0003', ...over,
})
const reasons = (res: { body: { rejected: { reason: string }[] } }) => res.body.rejected.map((r) => r.reason)

describe('referral origin and event authority', () => {
  it('refuses a referral or stub created under another device as origin', async () => {
    const volunteer = await activate('V001', '0240000002')
    const spoof = await pushAs(volunteer, [
      { table: 'referrals', row: referralRow() },
      { table: 'referral_events', row: event({ referral_id: 'r-stub', status: 'arrived', source_device_id: 'V001' }) },
    ])
    expect(reasons(spoof)).toEqual(['forbidden', 'unknown_referral'])
    expect(await db.select().from(referrals)).toHaveLength(0)

    // A carried referral (QR hop) is accepted from another device when it brings the origin's signed LFR.
    const carried = await pushAs(volunteer, [{ table: 'referrals', row: referralRow({ lfr: encode(lfr, KEYS.D001!) }) }])
    expect(carried.body.accepted).toEqual(['r-spoof'])
    const forged = await pushAs(volunteer, [{ table: 'referrals', row: referralRow({ id: 'r-2', short_id: 'AAAAAAAA', lfr: encode({ ...lfr, short_id: 'AAAAAAAA' }, KEYS.V001!) }) }])
    expect(reasons(forged)).toEqual(['forbidden'])
  })

  it('allows events only from the origin, the destination or an onward hop', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: referralRow() }])
    const ev = (by: string, status: string) => ({ table: 'referral_events', row: event({ referral_id: 'r-spoof', status, source_device_id: by }) })

    const unrelated = await activate('F002', '0200000002')
    expect(reasons(await pushAs(unrelated, [ev('F002', 'closed')]))).toEqual(['forbidden'])
    const compound = await activate('F001', '0200000001') // the origin's own facility, but not the destination
    expect(reasons(await pushAs(compound, [ev('F001', 'closed')]))).toEqual(['forbidden'])
    const dest = await activate('F003', '0200000003')
    expect(reasons(await pushAs(dest, [ev('F003', 'arrived')]))).toEqual([])

    // F003 refers onward to F002: F003 stays allowed as a hop, F002 is now the destination.
    expect(reasons(await pushAs(dest, [{ table: 'referrals', row: referralRow({ updated_at: TODAY + 1, destination_facility_id: 'fac-0002' }) }]))).toEqual([])
    expect(reasons(await pushAs(dest, [ev('F003', 'treated')]))).toEqual([])
    expect(reasons(await pushAs(unrelated, [ev('F002', 'treated')]))).toEqual([])
  })
})

describe('inbound LFS authority', () => {
  it('refuses an LFS signed by a device that may not act on the referral, accepts the destination facility', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: referralRow() }])
    const created = await request(app).post('/admin/devices').set(ADMIN).send({ id: 'D002', role: 'cho', user_name: 'Other CHO', facility_code: 'SAV-CHPS-01' })
    const other = await request(app).post('/auth/activate').send({ activation_code: created.body.activation_code, phone_number: '0240000009' })
    const otherKey = other.body.device_key as string

    const forged = await sms(encode({ kind: 'LFS', signer: 'D002', origin: 'D001', short_id: SID, status: 'A' }, otherKey))
    expect(forged.body).toEqual({ ok: false, error: 'forbidden' })
    const unknown = await sms(encode({ kind: 'LFS', signer: 'D002', origin: 'D001', short_id: 'ZZZZZZZZ', status: 'A' }, otherKey))
    expect(unknown.body).toEqual({ ok: false, error: 'forbidden' }) // no stub for someone else's referral
    let [r] = await db.select().from(referrals)
    expect(r!.status).toBe('created')
    expect(await db.select().from(referrals)).toHaveLength(1)

    const dest = await sms(encode({ kind: 'LFS', signer: 'F003', origin: 'D001', short_id: SID, status: 'A' }, KEYS.F003!))
    expect(dest.body).toMatchObject({ ok: true, kind: 'status', status: 'arrived' })
    ;[r] = await db.select().from(referrals)
    expect(r!.status).toBe('arrived')
  })
})

describe('credentials', () => {
  it('never takes credentials from the query string; SSE uses a single-use ticket', async () => {
    const jwt = await activate('F003', '0200000003')
    expect((await request(app).get(`/sync/pull?token=${jwt}`)).status).toBe(401)
    expect((await request(app).get('/events?facility=SAV-HOSP-01&token=test-admin-token')).status).toBe(401)
    const t = await request(app).post('/events/ticket').set(bearer(jwt)).send({ facility: 'SAV-HOSP-01' })
    expect(t.status).toBe(200)
    expect((await request(app).post('/events/ticket').set(bearer(jwt)).send({ facility: 'PTA-HC-01' })).status).toBe(403)

    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    try {
      const ctl = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/events?ticket=${t.body.ticket}`, { signal: ctl.signal })
      expect(res.status).toBe(200)
      expect(new TextDecoder().decode((await res.body!.getReader().read()).value)).toContain('event: ready')
      ctl.abort()
      expect((await fetch(`http://127.0.0.1:${port}/events?ticket=${t.body.ticket}`)).status).toBe(401)
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  it('requires the webhook token when configured', async () => {
    env.SMS_WEBHOOK_TOKEN = 'webhook-secret-webhook-secret'
    try {
      expect((await sms('hello')).status).toBe(401)
      expect((await request(app).post('/sms/inbound?token=wrong').send({ from: '0240000001', text: 'x' })).status).toBe(401)
      const ok = await request(app).post('/sms/inbound').set('x-webhook-token', 'webhook-secret-webhook-secret').send({ from: '0240000001', text: 'x' })
      expect(ok.status).toBe(200)
    } finally {
      env.SMS_WEBHOOK_TOKEN = undefined
    }
  })

  it('refuses to boot in production without its secrets', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/env.ts')"], {
      cwd: new URL('..', import.meta.url).pathname, env: { PATH: process.env.PATH, NODE_ENV: 'production' }, encoding: 'utf8',
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('JWT_SECRET')
    expect(r.stderr).toContain('SMS_WEBHOOK_TOKEN')
  })
})
