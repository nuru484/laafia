import { encode } from '@laafia/core'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { DEMO_CODES } from '../../../seed-demo.ts'
import { ADMIN, KEYS, activate, app, bearer, lfr, prisma, pullAs, sms, useDb } from '../../../platform/testing/helpers.ts'

useDb()

describe('activation and tokens', () => {
  it('returns 401 deactivated after an admin deactivates the device, and drops its key', async () => {
    const jwt = await activate('D001')
    expect((await pullAs(jwt)).status).toBe(200)
    expect((await request(app).post('/admin/devices/D001/deactivate').set(ADMIN)).status).toBe(200)
    const res = await pullAs(jwt)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('deactivated')
    expect((await request(app).post('/auth/refresh').set(bearer(jwt))).body.code).toBe('deactivated')
    expect((await sms(encode(lfr, KEYS.D001!))).body).toEqual({ ok: false, error: 'unknown_signer' })
    const facility = await activate('F001', '0200000001')
    expect((await pullAs(facility)).body.keys.D001).toBeUndefined()
  })

  it('accepts an activation code once', async () => {
    await activate('D001')
    const again = await request(app).post('/auth/activate').send({ activation_code: DEMO_CODES.D001, phone_number: '0240000001' })
    expect(again.status).toBe(400)
    expect(again.body.code).toBe('invalid_code')
  })

  it('returns the profile in the wire format and refreshes a token', async () => {
    const res = await request(app).post('/auth/activate').send({ activation_code: DEMO_CODES.D001, phone_number: '+233 24 000 0001' })
    expect(res.body).toMatchObject({
      device_id: 'D001', device_key: KEYS.D001,
      profile: { device_id: 'D001', role: 'cho', phone_number: '0240000001', facility: { id: 'fac-0001', code: 'SAV-CHPS-01', district_id: 'dist-sav' } },
    })
    expect(res.body.profile.facility).not.toHaveProperty('seq')
    const refreshed = await request(app).post('/auth/refresh').set(bearer(res.body.jwt))
    expect(refreshed.status).toBe(200)
    expect(typeof refreshed.body.jwt).toBe('string')
  })
})

describe('facility phone number', () => {
  it('sets the facility phone from the facility device that activated last, and phones pull it', async () => {
    const cho = await activate('D001')
    const { body: first } = await pullAs(cho)
    await activate('F003', '+233 20 999 0003')
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: 'fac-0003' } })).phone).toBe('0209990003')
    const next = await pullAs(cho, first.cursor)
    expect(next.body.records).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'facilities', row: expect.objectContaining({ id: 'fac-0003', phone: '0209990003' }) })]))

    // A second facility device at the same facility takes over once it activates.
    const created = await request(app).post('/admin/devices').set(ADMIN).send({ id: 'F009', role: 'facility', user_name: 'Hospital spare', facility_code: 'SAV-HOSP-01' })
    await request(app).post('/auth/activate').send({ activation_code: created.body.activation_code, phone_number: '0209990009' })
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: 'fac-0003' } })).phone).toBe('0209990009')
    // A CHO activating never touches the facility phone.
    expect((await prisma.facility.findUniqueOrThrow({ where: { id: 'fac-0001' } })).phone).toBe('0200000001')
  })
})

describe('key directory policy', () => {
  it('gives CHOs their district facility keys and facilities the field device keys', async () => {
    const cho = await pullAs(await activate('D001'))
    expect(Object.keys(cho.body.keys).sort()).toEqual(['F001', 'F002', 'F003', 'GW01'])
    expect(cho.body.keys.F003).toBe(KEYS.F003)
    const fac = await pullAs(await activate('F001', '0200000001'))
    expect(fac.body.keys).toMatchObject({ D001: KEYS.D001, D002: KEYS.D002 })
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

describe('credentials', () => {
  it('never takes credentials from the query string', async () => {
    const jwt = await activate('F003', '0200000003')
    expect((await request(app).get(`/sync/pull?token=${jwt}`)).status).toBe(401)
    expect((await request(app).get('/admin/devices?token=test-admin-token')).status).toBe(401)
  })
})
