import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { GATEWAY_DEVICE } from '../modules/referrals/index.ts'
import { app, deps, prisma, useDb } from '../platform/testing/helpers.ts'
import { seedAdmin, seedConfig } from '../seed.ts'

useDb()

const ENV = {
  SEED_ADMIN_NAME: 'Fatima Alhassan', SEED_ADMIN_EMAIL: 'fatima@ghs.example', SEED_ADMIN_PASSWORD: 'first-password-1',
  SEED_DISTRICT_CODE: 'KMB', SEED_DISTRICT_NAME: 'Kumbungu',
}

describe('admin seed', () => {
  it('names every missing variable instead of seeding half an account', () => {
    expect(() => seedConfig({ SEED_ADMIN_EMAIL: 'a@b.c' })).toThrow(/SEED_ADMIN_NAME.*SEED_ADMIN_PASSWORD.*SEED_DISTRICT_CODE.*SEED_DISTRICT_NAME/)
    expect(() => seedConfig({ ...ENV, SEED_ADMIN_PASSWORD: 'short' })).toThrow(/10 characters/)
  })

  it('creates the district, the SMS gateway and a district admin who can sign in', async () => {
    await prisma.device.delete({ where: { id: GATEWAY_DEVICE } })
    await seedAdmin(deps, seedConfig(ENV))
    const district = await prisma.district.findUniqueOrThrow({ where: { code: 'KMB' } })
    expect(district.name).toBe('Kumbungu')
    expect(await prisma.device.findUniqueOrThrow({ where: { id: GATEWAY_DEVICE } })).toMatchObject({ role: 'gateway', keyHex: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const login = await request(app).post('/web/login').send({ login: ENV.SEED_ADMIN_EMAIL, password: ENV.SEED_ADMIN_PASSWORD })
    expect(login.status).toBe(200)
    expect(login.body.user).toMatchObject({ role: 'district_admin', district: { code: 'KMB' } })
  })

  it('re-runs without touching the password, the gateway key or the district', async () => {
    await seedAdmin(deps, seedConfig(ENV))
    const key = (await prisma.device.findUniqueOrThrow({ where: { id: GATEWAY_DEVICE } })).keyHex
    await seedAdmin(deps, seedConfig({ ...ENV, SEED_ADMIN_PASSWORD: 'second-password-2', SEED_DISTRICT_NAME: 'Renamed' }))
    expect((await request(app).post('/web/login').send({ login: ENV.SEED_ADMIN_EMAIL, password: ENV.SEED_ADMIN_PASSWORD })).status).toBe(200)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: GATEWAY_DEVICE } })).keyHex).toBe(key)
    expect((await prisma.district.findUniqueOrThrow({ where: { code: 'KMB' } })).name).toBe('Kumbungu')
    expect(await prisma.user.count({ where: { email: ENV.SEED_ADMIN_EMAIL } })).toBe(1)
  })
})
