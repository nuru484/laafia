import { describe, expect, it } from 'vitest'
import { USERS, activate, prisma, pullAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()

const T = 1_700_000_000_000
const house = (id: string, facilityId: string, community = 'Kanshegu') =>
  prisma.household.create({ data: { id, updatedAt: BigInt(T), facilityId, community, headName: 'Naa Test', consentAt: BigInt(T) } })
const client = (id: string, householdId: string, facilityId: string, over: Record<string, unknown> = {}) =>
  prisma.client.create({ data: { id, updatedAt: BigInt(T), facilityId, householdId, code: `CL-${id}`, type: 'pregnant', name: 'Fati Mahama', deviceId: 'D001', ...over } })

/** The same woman enrolled on two phones: one record by phone number, one by name in the same community. */
async function twins() {
  await house('hh-a', 'fac-0001')
  await house('hh-b', 'fac-0001')
  await client('cl-keep', 'hh-a', 'fac-0001', { phone: '0241112233' })
  await client('cl-dup', 'hh-b', 'fac-0001', { phone: '0241112233', name: 'Fatimata Mahama', deviceId: 'D002' })
  await prisma.visit.create({ data: { id: 'vi-dup', updatedAt: BigInt(T), facilityId: 'fac-0001', clientId: 'cl-dup', protocolId: 'maternal', visitedAt: BigInt(T), answers: {}, outcome: 'routine', ruleId: 'M-DEFAULT' } })
  // Another district's client with the same number is not this admin's business.
  await house('hh-t', 'fac-0004', 'Tamale')
  await client('cl-other', 'hh-t', 'fac-0004', { phone: '0241112233' })
}

describe('duplicate clients across phones', () => {
  it('lists clients who share a phone number, or a name and type in one community, within the district', async () => {
    await twins()
    await house('hh-c', 'fac-0001')
    await client('cl-name-1', 'hh-c', 'fac-0001', { name: 'Ama Yakubu', type: 'child' })
    await client('cl-name-2', 'hh-c', 'fac-0001', { name: ' ama  YAKUBU ', type: 'child' })
    const { agent } = await signIn(USERS.admin)
    const res = await agent.get('/admin/clients/duplicates')
    expect(res.status).toBe(200)
    const groups = res.body.groups as { reason: string; clients: { id: string; visits: number }[] }[]
    const byPhone = groups.find((g) => g.clients.some((c) => c.id === 'cl-dup'))!
    expect(byPhone.reason).toBe('same phone')
    expect(byPhone.clients.map((c) => c.id).sort()).toEqual(['cl-dup', 'cl-keep'])
    expect(byPhone.clients.find((c) => c.id === 'cl-dup')!.visits).toBe(1)
    expect(groups.find((g) => g.clients.some((c) => c.id === 'cl-name-1'))!.reason).toBe('same name')
    expect(groups.flatMap((g) => g.clients).some((c) => c.id === 'cl-other')).toBe(false)
  })

  it('merges a duplicate into the record kept: its visits move, it is removed, and phones pull both changes', async () => {
    await twins()
    const cho = await activate('D001')
    const { body: first } = await pullAs(cho)
    const { agent, csrf } = await signIn(USERS.admin)
    const res = await agent.post('/admin/clients/cl-dup/merge').set(csrf).send({ into: 'cl-keep' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ kept: 'cl-keep', moved: { visits: 1, referrals: 0 } })
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: 'vi-dup' } })).clientId).toBe('cl-keep')
    expect((await prisma.client.findUniqueOrThrow({ where: { id: 'cl-dup' } })).deleted).toBe(true)
    expect(await prisma.auditEvent.count({ where: { action: 'client.merge', targetId: 'cl-dup' } })).toBe(1)
    const pulled = (await pullAs(cho, first.cursor)).body.records as { table: string; row: { id: string; deleted?: boolean; client_id?: string } }[]
    expect(pulled.find((r) => r.table === 'clients' && r.row.id === 'cl-dup')?.row.deleted).toBe(true)
    expect(pulled.find((r) => r.table === 'visits' && r.row.id === 'vi-dup')?.row.client_id).toBe('cl-keep')
  })

  it('refuses a merge by a supervisor, across client types, outside the district, and into itself', async () => {
    await twins()
    await client('cl-child', 'hh-a', 'fac-0001', { type: 'child', name: 'Baby' })
    const sup = await signIn(USERS.supervisor)
    expect((await sup.agent.post('/admin/clients/cl-dup/merge').set(sup.csrf).send({ into: 'cl-keep' })).status).toBe(403)
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await agent.post('/admin/clients/cl-dup/merge').set(csrf).send({ into: 'cl-child' })).body.code).toBe('different_types')
    expect((await agent.post('/admin/clients/cl-other/merge').set(csrf).send({ into: 'cl-keep' })).status).toBe(404)
    expect((await agent.post('/admin/clients/cl-dup/merge').set(csrf).send({ into: 'cl-dup' })).status).toBe(400)
  })
})
