import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetActivationLimits } from '../src/auth.ts'
import { DEMO_CODES } from '../src/seed.ts'
import { KEYS, activate, app, pullAs, useDb } from './helpers.ts'

useDb()
beforeEach(() => resetActivationLimits())

describe('key directory policy', () => {
  it('gives CHOs their district facility keys, volunteers none, facilities the field device keys', async () => {
    const cho = await pullAs(await activate('D001'))
    expect(Object.keys(cho.body.keys).sort()).toEqual(['F001', 'F002', 'F003', 'GW01'])
    expect(cho.body.keys.F003).toBe(KEYS.F003)
    const vol = await pullAs(await activate('V001', '0240000002'))
    expect(vol.body.keys).toBeUndefined()
    const fac = await pullAs(await activate('F001', '0200000001'))
    expect(fac.body.keys).toMatchObject({ D001: KEYS.D001, V001: KEYS.V001 })
  })

  it('returns the same directory at activation', async () => {
    const res = await request(app).post('/auth/activate').send({ activation_code: DEMO_CODES.D001, phone_number: '0240000001' })
    expect(Object.keys(res.body.keys).sort()).toEqual(['F001', 'F002', 'F003', 'GW01'])
  })
})

describe('activation rate limit', () => {
  const attempt = (code: string, ip = '10.0.0.1') =>
    request(app).post('/auth/activate').set('X-Forwarded-For', ip).send({ activation_code: code, phone_number: '0240000001' })

  it('allows 5 attempts per IP per 15 minutes, then 429', async () => {
    for (let i = 0; i < 5; i++) expect((await attempt(`9999000${i}`)).status).toBe(400)
    const blocked = await attempt(DEMO_CODES.D001!)
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('rate_limited')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect((await attempt(DEMO_CODES.D001!, '10.0.0.2')).status).toBe(200)
  })

  it('allows 5 attempts per code across IPs, then 429', async () => {
    for (let i = 0; i < 5; i++) expect((await attempt('99990009', `10.1.0.${i}`)).status).toBe(400)
    expect((await attempt('99990009', '10.1.0.99')).status).toBe(429)
  })
})
