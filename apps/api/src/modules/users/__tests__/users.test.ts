import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ADMIN, DEMO_PASSWORD, SID, TODAY, USERS, activate, app, prisma, pushAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()

const login = (login: string, password: string, ip = '10.9.0.1') => request(app).post('/web/login').set('X-Forwarded-For', ip).send({ login, password })

describe('dashboard sign-in', () => {
  it('sets an httpOnly session cookie and a readable CSRF cookie, and returns the user', async () => {
    const res = await login(USERS.admin, DEMO_PASSWORD)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ email: USERS.admin, role: 'district_admin', district: { code: 'SAV' } })
    expect(res.body.csrf_token).toEqual(expect.any(String))
    const cookies = res.headers['set-cookie'] as unknown as string[]
    expect(cookies.find((c) => c.startsWith('laafia_session='))).toMatch(/HttpOnly/)
    expect(cookies.find((c) => c.startsWith('laafia_session='))).toMatch(/SameSite=Lax/)
    expect(cookies.find((c) => c.startsWith('laafia_csrf='))).not.toMatch(/HttpOnly/)
    expect((await prisma.user.findUniqueOrThrow({ where: { email: USERS.admin } })).lastLoginAt).toEqual(expect.any(Number))
  })

  it('gives one answer for a wrong password, an unknown account and a deactivated one, and rate-limits', async () => {
    expect((await login(USERS.admin, 'wrong-password')).body.code).toBe('invalid_credentials')
    expect((await login('nobody@laafia.demo', DEMO_PASSWORD, '10.9.0.2')).body.code).toBe('invalid_credentials')
    await prisma.user.update({ where: { email: USERS.supervisor }, data: { active: false } })
    expect((await login(USERS.supervisor, DEMO_PASSWORD, '10.9.0.3')).status).toBe(401)
    for (let i = 0; i < 4; i++) await login(USERS.admin, 'wrong-password', `10.9.1.${i}`) // 5 tries for this account in all
    expect((await login(USERS.admin, DEMO_PASSWORD, '10.9.2.1')).status).toBe(429)
  })

  it('requires the CSRF header on mutations and revokes the session on logout', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await agent.get('/web/me')).body.user).toMatchObject({ role: 'district_admin' })
    const noCsrf = await agent.post('/admin/users').send({ name: 'X', email: 'x@laafia.demo', password: 'long-enough-1', role: 'supervisor' })
    expect(noCsrf.status).toBe(403)
    expect(noCsrf.body.code).toBe('csrf')
    expect((await agent.post('/admin/users').set('X-CSRF-Token', 'not-the-token').send({})).body.code).toBe('csrf')
    expect((await agent.post('/web/logout')).status).toBe(200)
    expect((await agent.get('/web/me')).status).toBe(401)
    expect((await request(app).get('/web/me')).status).toBe(401)
  })
})

describe('user administration', () => {
  it('lets a district admin create, reset and deactivate accounts in their district', async () => {
    const { agent, csrf, user: me } = await signIn(USERS.admin)
    const created = await agent.post('/admin/users').set(csrf).send({ name: 'Mariama Osman', email: 'Mariama@laafia.demo', password: 'first-pass-123', role: 'facility_staff', facility_code: 'PTA-HC-01' })
    expect(created.status).toBe(201)
    expect(created.body.user).toMatchObject({ email: 'mariama@laafia.demo', role: 'facility_staff', facility_id: 'fac-0002' })
    expect(created.body.user).not.toHaveProperty('password_hash')
    const id = created.body.user.id as string

    const staff = await signIn('mariama@laafia.demo', 'first-pass-123')
    expect((await agent.post(`/admin/users/${id}/password`).set(csrf).send({ password: 'second-pass-456' })).status).toBe(200)
    expect((await staff.agent.get('/web/me')).status).toBe(401) // reset ends their sessions
    await signIn('mariama@laafia.demo', 'second-pass-456')
    expect((await agent.post(`/admin/users/${id}/deactivate`).set(csrf)).body.user.active).toBe(false)
    expect((await login('mariama@laafia.demo', 'second-pass-456', '10.9.3.1')).status).toBe(401)

    const list = await agent.get('/admin/users')
    expect(list.body.users.map((u: { email: string }) => u.email)).toEqual(expect.arrayContaining([USERS.admin, USERS.hospital, 'mariama@laafia.demo']))
    expect((await agent.post(`/admin/users/${me.id}/deactivate`).set(csrf)).status).toBe(400) // not yourself
  })

  it("edits an account's name, email and phone, refusing a clash or no way to sign in", async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    const target = await prisma.user.findUniqueOrThrow({ where: { email: USERS.supervisor } })
    const edited = await agent.patch(`/admin/users/${target.id}`).set(csrf).send({ name: 'Dr. Fuseini A.', email: 'Fuseini@GHS.example', phone: '+233 24 777 1234' })
    expect(edited.status).toBe(200)
    expect(edited.body.user).toMatchObject({ name: 'Dr. Fuseini A.', email: 'fuseini@ghs.example', phone: '0247771234' })
    expect((await login('fuseini@ghs.example', DEMO_PASSWORD, '10.9.5.1')).status).toBe(200)
    expect((await agent.patch(`/admin/users/${target.id}`).set(csrf).send({ email: USERS.hospital })).status).toBe(409)
    expect((await agent.patch(`/admin/users/${target.id}`).set(csrf).send({ email: null, phone: null })).status).toBe(400)
    const outside = await prisma.user.create({ data: { id: 'u-out', name: 'X', email: 'x@tml.example', passwordHash: 'x', role: 'supervisor', districtId: 'dist-tml', passwordChangedAt: 0, createdAt: 0 } })
    expect((await agent.patch(`/admin/users/${outside.id}`).set(csrf).send({ name: 'Y' })).status).toBe(404)
  })

  it('refuses accounts outside the district and other roles managing users', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    const out = await agent.post('/admin/users').set(csrf).send({ name: 'T', email: 't@laafia.demo', password: 'long-enough-1', role: 'facility_staff', facility_code: 'TTH-HOSP-01' })
    expect(out.status).toBe(403)
    const sup = await signIn(USERS.supervisor)
    expect((await sup.agent.get('/admin/users')).status).toBe(403)
    const staff = await signIn(USERS.hospital)
    expect((await staff.agent.post('/admin/users/usr-0002/password').set(staff.csrf).send({ password: 'long-enough-1' })).status).toBe(403)
  })
})

describe('scope: one facility cannot see another', () => {
  const toHospital = { id: 'r-h', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0001', client_code: 'CL-0001', urgency: 3, destination_facility_id: 'fac-0003' }

  it('keeps facility staff to their own inbox, referrals and actions', async () => {
    await pushAs(await activate('D001'), [{ table: 'referrals', row: toHospital }])
    const hospital = await signIn(USERS.hospital)
    const hc = await signIn(USERS.healthCentre)

    expect((await hospital.agent.get('/referrals?facility=SAV-HOSP-01')).body.referrals.map((r: { id: string }) => r.id)).toEqual(['r-h'])
    expect((await hc.agent.get('/referrals?facility=SAV-HOSP-01')).status).toBe(403)
    expect((await hc.agent.get('/referrals')).body.referrals).toEqual([]) // only Pong-Tamale's
    expect((await hc.agent.get('/referrals/r-h')).status).toBe(404)
    expect((await hc.agent.post('/referrals/r-h/status').set(hc.csrf).send({ status: 'arrived' })).status).toBe(404)
    expect((await hc.agent.post('/events/ticket').set(hc.csrf).send({ facility: 'SAV-HOSP-01' })).status).toBe(403)
    expect((await hc.agent.get('/admin/devices')).status).toBe(403)

    const ok = await hospital.agent.post('/referrals/r-h/status').set(hospital.csrf).send({ status: 'arrived' })
    expect(ok.body.referral.status).toBe('arrived')
    expect(ok.body.referral.events.at(-1).source_device_id).toBe('web:usr-0003')
  })

  it('lets a supervisor read the district board but not act', async () => {
    await pushAs(await activate('D001'), [{ table: 'referrals', row: toHospital }])
    const sup = await signIn(USERS.supervisor)
    expect((await sup.agent.get('/referrals')).body.referrals.map((r: { id: string }) => r.id)).toEqual(['r-h'])
    expect((await sup.agent.post('/referrals/r-h/status').set(sup.csrf).send({ status: 'arrived' })).status).toBe(403)
    expect((await sup.agent.get('/dashboard/summary')).status).toBe(200)
  })

  it('keeps a district admin to their district and leaves the script token unscoped', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await agent.post('/admin/devices').set(csrf).send({ role: 'cho', user_name: 'X', facility_code: 'TTH-HOSP-01' })).status).toBe(403)
    expect((await agent.get('/admin/devices')).body.devices.map((d: { id: string }) => d.id)).not.toContain('GW01')
    expect((await request(app).get('/admin/devices').set(ADMIN)).body.devices.map((d: { id: string }) => d.id)).toContain('GW01')
  })
})

describe('own account', () => {
  it('lets any signed-in user change their own name and sign-in details, never their role', async () => {
    const { agent, csrf } = await signIn(USERS.supervisor)
    const r = await agent.patch('/web/me').set(csrf).send({ name: 'Dr. F. Abdulai', phone: '0241119999' })
    expect(r.status).toBe(200)
    expect(r.body.user).toMatchObject({ name: 'Dr. F. Abdulai', phone: '0241119999', role: 'supervisor' })
    expect((await agent.patch('/web/me').set(csrf).send({ role: 'district_admin' })).status).toBe(400)
    expect((await agent.patch('/web/me').set(csrf).send({ email: USERS.admin })).body.code).toBe('conflict')
    expect((await agent.patch('/web/me').send({ name: 'No CSRF' })).status).toBe(403)
  })

  it('changes the password only with the current one, and signs out the other sessions', async () => {
    const one = await signIn(USERS.supervisor)
    const two = await signIn(USERS.supervisor)
    const wrong = await one.agent.post('/web/me/password').set(one.csrf).send({ current_password: 'not-my-password', new_password: 'brand-new-pass-1' })
    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe('wrong_password')
    expect((await one.agent.post('/web/me/password').set(one.csrf).send({ current_password: DEMO_PASSWORD, new_password: 'short' })).status).toBe(400)
    expect((await one.agent.post('/web/me/password').set(one.csrf).send({ current_password: DEMO_PASSWORD, new_password: 'brand-new-pass-1' })).status).toBe(200)
    expect((await one.agent.get('/web/me')).status).toBe(200)
    expect((await two.agent.get('/web/me')).status).toBe(401)
    expect((await login(USERS.supervisor, 'brand-new-pass-1', '10.9.5.1')).status).toBe(200)
  })
})
