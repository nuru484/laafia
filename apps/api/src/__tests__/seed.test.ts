import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, deps, prisma, useDb } from '../platform/testing/helpers.ts'
import { seedAdmins, seedDemo, seedUsersFromEnv } from '../seed-demo.ts'

useDb()

const ENV = {
  SEED_ADMINS: 'Fatima Alhassan <Fatima@ghs.example>, Issah Mahama <issah@ghs.example>', SEED_PASSWORD: 'first-password-1',
  SEED_DISTRICT_CODE: 'kmb', SEED_DISTRICT_NAME: 'Kumbungu',
}

describe('seed', () => {
  it('reads the admins, password and district from the environment, naming every problem', () => {
    expect(seedUsersFromEnv(ENV)).toEqual({
      password: 'first-password-1', district: { code: 'KMB', name: 'Kumbungu' },
      admins: [{ name: 'Fatima Alhassan', email: 'fatima@ghs.example' }, { name: 'Issah Mahama', email: 'issah@ghs.example' }],
    })
    expect(() => seedUsersFromEnv({ SEED_ADMINS: 'Fatima fatima@ghs.example', SEED_PASSWORD: 'short' }))
      .toThrow(/SEED_PASSWORD.*SEED_DISTRICT_CODE.*SEED_DISTRICT_NAME.*SEED_ADMINS/)
  })

  it('starts a new district with its admins, who can sign in', async () => {
    await seedAdmins(deps, seedUsersFromEnv(ENV))
    const kmb = await prisma.district.findUniqueOrThrow({ where: { code: 'KMB' } })
    expect(await prisma.user.findUniqueOrThrow({ where: { email: 'issah@ghs.example' } })).toMatchObject({ role: 'district_admin', districtId: kmb.id })
    expect((await request(app).post('/web/login').send({ login: 'fatima@ghs.example', password: 'first-password-1' })).status).toBe(200)
  })

  it('folds a district made earlier under a demo code into the demo district', async () => {
    await prisma.facility.updateMany({ where: { districtId: 'dist-tml' }, data: { districtId: null } })
    await prisma.district.delete({ where: { id: 'dist-tml' } })
    await prisma.district.create({ data: { id: 'old-tml', code: 'TML', name: 'Tamale' } })
    await prisma.user.create({ data: { id: 'u-old', name: 'Old Admin', email: 'old@ghs.example', passwordHash: 'x', role: 'district_admin', districtId: 'old-tml', active: true, passwordChangedAt: 0, createdAt: 0 } })
    await seedDemo(deps, seedUsersFromEnv({ ...ENV, SEED_DISTRICT_CODE: 'SAV' }))
    expect(await prisma.district.findUnique({ where: { id: 'old-tml' } })).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'u-old' } })).toMatchObject({ districtId: 'dist-tml' })
    expect(await prisma.user.findUniqueOrThrow({ where: { email: 'fatima@ghs.example' } })).toMatchObject({ districtId: 'dist-sav' })
  })
})
