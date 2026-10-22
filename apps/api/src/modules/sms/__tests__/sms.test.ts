import { encode } from '@laafia/core'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { env } from '../../../config/env.ts'
import { ADMIN, KEYS, SID, TODAY, activate, app, lfr, prisma, pushAs, sms, useDb } from '../../../platform/testing/helpers.ts'

useDb()

describe('inbound SMS verification', () => {
  it('rejects a bad signature and an unknown signer', async () => {
    const body = encode(lfr, KEYS.D001!)
    expect((await sms(body.replace('|3|', '|1|'))).body).toEqual({ ok: false, error: 'bad_signature' })
    expect((await sms(encode(lfr, KEYS.D002!))).body).toEqual({ ok: false, error: 'bad_signature' })
    expect((await sms(encode({ ...lfr, signer: 'ZZ99' }, KEYS.D001!))).body).toEqual({ ok: false, error: 'unknown_signer' })
    expect((await sms('Hello, are you coming?')).body).toEqual({ ok: false, error: 'not_laafia' })
    expect(await prisma.referral.findMany()).toHaveLength(0)
  })

  it('refuses an LFS signed by a device that may not act on the referral, accepts the destination facility', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: { id: 'r-spoof', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_code: 'CL-0041', urgency: 3, client_type: 'postpartum', danger_signs: ['bleeding'], destination_facility_id: 'fac-0003' } }])
    const created = await request(app).post('/admin/devices').set(ADMIN).send({ id: 'D009', role: 'cho', user_name: 'Other CHO', facility_code: 'SAV-CHPS-01' })
    const other = await request(app).post('/auth/activate').send({ activation_code: created.body.activation_code, phone_number: '0240000009' })
    const otherKey = other.body.device_key as string

    const forged = await sms(encode({ kind: 'LFS', signer: 'D009', origin: 'D001', short_id: SID, status: 'A' }, otherKey))
    expect(forged.body).toEqual({ ok: false, error: 'forbidden' })
    const unknown = await sms(encode({ kind: 'LFS', signer: 'D009', origin: 'D001', short_id: 'ZZZZZZZZ', status: 'A' }, otherKey))
    expect(unknown.body).toEqual({ ok: false, error: 'forbidden' }) // no stub for someone else's referral
    expect(await prisma.referral.findMany()).toHaveLength(1)
    expect((await prisma.referral.findFirst())!.status).toBe('created')

    const dest = await sms(encode({ kind: 'LFS', signer: 'F003', origin: 'D001', short_id: SID, status: 'A' }, KEYS.F003!))
    expect(dest.body).toMatchObject({ ok: true, kind: 'status', status: 'arrived' })
    expect((await prisma.referral.findFirst())!.status).toBe('arrived')
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
})
