import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { DEMO_CODES } from '../../../seed.ts'
import { USERS, activate, app, prisma, pullAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()

describe('facilities, providers and devices from the dashboard', () => {
  it('creates and edits facilities in the district, and phones pull them', async () => {
    const cho = await activate('D001')
    const { body: first } = await pullAs(cho)
    const { agent, csrf } = await signIn(USERS.admin)
    const created = await agent.post('/admin/facilities').set(csrf).send({ code: 'SAV-CHPS-09', name: 'Moglaa CHPS', level: 'chps', phone: '+233 20 000 0009', lat: 9.655, lng: -0.87, capabilities: [], languages: ['dag'] })
    expect(created.status).toBe(201)
    expect(created.body.facility).toMatchObject({ code: 'SAV-CHPS-09', district_id: 'dist-sav', phone: '0200000009' })
    const id = created.body.facility.id as string
    expect((await agent.patch(`/admin/facilities/${id}`).set(csrf).send({ capabilities: ['bemonc'] })).body.facility.capabilities).toEqual(['bemonc'])
    const pulled = (await pullAs(cho, first.cursor)).body.records
    expect(pulled.find((r: { table: string; row: { id: string } }) => r.table === 'facilities' && r.row.id === id)).toBeTruthy()
    expect((await agent.post('/admin/facilities').set(csrf).send({ code: 'SAV-CHPS-09', name: 'Dup', level: 'chps', lat: 9, lng: -1 })).status).toBe(409)
    expect((await agent.patch('/admin/facilities/fac-0004').set(csrf).send({ name: 'Not mine' })).status).toBe(404) // Tamale district

    const staff = await signIn(USERS.hospital)
    expect((await staff.agent.get('/admin/facilities')).body.facilities.map((f: { code: string }) => f.code)).toEqual(['SAV-HOSP-01'])
    expect((await staff.agent.post('/admin/facilities').set(staff.csrf).send({ code: 'X-01', name: 'X', level: 'chps', lat: 9, lng: -1 })).status).toBe(403)
  })

  it('manages transport providers per community, including retiring one', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    const created = await agent.post('/admin/transport/providers').set(csrf).send({ facility_code: 'SAV-CHPS-01', name: 'Diare tricycle', phone: '0240000150', vehicle: 'tricycle', community: 'Diare' })
    expect(created.status).toBe(201)
    const retired = await agent.patch(`/admin/transport/providers/${created.body.provider.id}`).set(csrf).send({ active: false })
    expect(retired.body.provider.active).toBe(false)
    const list = (await agent.get('/admin/transport/providers')).body.providers
    expect(list.find((p: { id: string }) => p.id === created.body.provider.id)).toMatchObject({ facility_code: 'SAV-CHPS-01', active: false })
    expect((await agent.post('/admin/transport/providers').set(csrf).send({ facility_code: 'TTH-HOSP-01', name: 'X', phone: '0240000151' })).status).toBe(403)
    const audit = (await agent.get('/admin/audit?target_type=transport_provider')).body.events.map((e: { action: string }) => e.action)
    expect(audit).toEqual(['provider.retire', 'provider.create'])
  })

  it('reissues an activation code for a replacement phone and reactivates the device', async () => {
    await activate('D001')
    const { agent, csrf } = await signIn(USERS.admin)
    await agent.post('/admin/devices/D001/deactivate').set(csrf)
    const res = await agent.post('/admin/devices/D001/code').set(csrf)
    expect(res.body).toMatchObject({ device: { id: 'D001', active: true }, activation_code: expect.stringMatching(/^\d{8}$/) })
    const ok = await request(app).post('/auth/activate').send({ activation_code: res.body.activation_code, phone_number: '0240000077' })
    expect(ok.status).toBe(200)
    expect(ok.body.device_key).toBe((await prisma.device.findUniqueOrThrow({ where: { id: 'D001' } })).keyHex)
    expect((await request(app).post('/auth/activate').send({ activation_code: DEMO_CODES.D001, phone_number: '0240000001' })).status).toBe(400)
    const listed = (await agent.get('/admin/devices')).body.devices.find((d: { id: string }) => d.id === 'D001')
    expect(listed).not.toHaveProperty('key_hex')
    const hc = await signIn(USERS.healthCentre)
    expect((await hc.agent.post('/admin/devices/D001/code').set(hc.csrf)).status).toBe(403)
  })
})
