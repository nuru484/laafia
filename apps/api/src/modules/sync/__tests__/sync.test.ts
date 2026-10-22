import { describe, expect, it } from 'vitest'
import { write } from '../../../platform/db.ts'
import { KEYS, TODAY, activate, household, prisma, pullAs, pushAs, useDb } from '../../../platform/testing/helpers.ts'

useDb()

describe('sync push', () => {
  it('is idempotent: the same batch twice changes nothing the second time', async () => {
    const jwt = await activate('D001')
    const batch = [
      { table: 'households', row: household() },
      { table: 'clients', row: { id: 'cl-new-1', updated_at: 1_000, household_id: 'hh-new-1', code: 'CL-9001', type: 'pregnant', name: 'Test Mother', edd: TODAY, phone: '0245556666', synced: 0 } },
    ]
    const first = await pushAs(jwt, batch)
    expect(first.body).toEqual({ accepted: ['hh-new-1', 'cl-new-1'], rejected: [] })
    const before = await prisma.household.findUnique({ where: { id: 'hh-new-1' } })
    const second = await pushAs(jwt, batch)
    expect(second.body).toEqual(first.body)
    const after = await prisma.household.findUnique({ where: { id: 'hh-new-1' } })
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)) // same seq: a no-op does not re-publish the row to pulls
    expect(after!.facilityId).toBe('fac-0001')
    const client = await prisma.client.findUnique({ where: { id: 'cl-new-1' } })
    expect(client).toMatchObject({ edd: TODAY, priorComplications: [], nhisActive: false, phone: '0245556666' })
  })

  it('applies last-writer-wins by updated_at and reports bad rows per row', async () => {
    const jwt = await activate('D001')
    await pushAs(jwt, [{ table: 'households', row: household({ head_name: 'A', updated_at: 100 }) }])
    const older = await pushAs(jwt, [{ table: 'households', row: household({ head_name: 'B', updated_at: 50 }) }])
    expect(older.body.accepted).toEqual(['hh-new-1'])
    const newer = await pushAs(jwt, [
      { table: 'households', row: household({ head_name: 'C', updated_at: 200 }) },
      { table: 'households', row: { id: 'hh-bad' } },
      { table: 'outbox', row: { id: 'x' } },
    ])
    expect(newer.body.accepted).toEqual(['hh-new-1'])
    expect(newer.body.rejected.map((r: { id: string; reason: string }) => [r.id, r.reason.split(':')[0]])).toEqual([['hh-bad', 'invalid'], ['x', 'unknown_table']])
    const row = await prisma.household.findUnique({ where: { id: 'hh-new-1' } })
    expect(row!.headName).toBe('C')
  })

  it('refuses to overwrite a row from another catchment', async () => {
    const other = await activate('F002', '0200000002')
    const res = await pushAs(other, [{ table: 'households', row: household({ id: 'hh-0001', updated_at: Date.now() + 1e9, head_name: 'Hijack' }) }])
    expect(res.body.rejected).toEqual([{ id: 'hh-0001', table: 'households', reason: 'forbidden' }])
  })
})

describe('sync pull', () => {
  const DAY = 86_400_000
  const now = Date.now()
  type Rec = { table: string; row: { id: string } }
  async function pullAll(jwt: string, limit = 37, stopAfter = Infinity) {
    const seen: string[] = []
    let cursor = ''
    let pages = 0
    for (let more = true; more && pages < stopAfter; pages++) {
      const res = await pullAs(jwt, cursor, limit)
      expect(res.status).toBe(200)
      expect(typeof res.body.cursor).toBe('string')
      seen.push(...res.body.records.map((r: Rec) => `${r.table}/${r.row.id}`))
      cursor = res.body.cursor
      more = res.body.more
    }
    return { seen, cursor }
  }
  const base = { updatedAt: now, deviceId: 'seed', deleted: false, facilityId: 'fac-0001', householdId: 'hh-0001', priorComplications: [], riskFlags: [], nhisActive: false }

  it('sends a lean, resumable first sync: active clients, recent visits, district facilities', async () => {
    await write(prisma, async (tx) => {
      await tx.client.createMany({
        data: [
          { ...base, id: 'old-pp', code: 'CL-0901', type: 'postpartum', name: 'Old PP', deliveryDate: now - 100 * DAY },
          { ...base, id: 'old-child', code: 'CL-0902', type: 'child', name: 'Old Child', dob: now - 70 * 30 * DAY },
          { ...base, id: 'old-referred', code: 'CL-0903', type: 'child', name: 'Referred', dob: now - 70 * 30 * DAY },
          { ...base, id: 'old-followup', code: 'CL-0904', type: 'postpartum', name: 'Follow-up', deliveryDate: now - 100 * DAY },
        ],
      })
      await tx.referral.create({ data: { id: 'r-open', updatedAt: now, originDeviceId: 'D001', shortId: 'AAAAAAAA', clientId: 'old-referred', facilityId: 'fac-0001', status: 'sent' } })
      const v = { updatedAt: now, facilityId: 'fac-0001', protocolId: 'maternal', ruleId: 'X', outcome: 'routine' }
      await tx.visit.createMany({
        data: [
          { ...v, id: 'v-due', clientId: 'old-followup', visitedAt: now - 10 * DAY, outcome: 'followup', followupDue: now - DAY },
          { ...v, id: 'v-ancient', clientId: 'cl-0001', visitedAt: now - 400 * DAY },
          { ...v, id: 'v-old-pp', clientId: 'old-pp', visitedAt: now - 90 * DAY },
        ],
      })
    })
    const jwt = await activate('D001')
    const { seen, cursor } = await pullAll(jwt)
    expect(new Set(seen).size).toBe(seen.length)
    const ids = (t: string) => seen.filter((s) => s.startsWith(t + '/')).map((s) => s.slice(t.length + 1))
    expect(ids('clients')).toHaveLength(50 + 2)
    expect(ids('clients')).toEqual(expect.arrayContaining(['old-referred', 'old-followup']))
    expect(ids('clients')).not.toEqual(expect.arrayContaining(['old-pp']))
    expect(ids('clients')).not.toEqual(expect.arrayContaining(['old-child']))
    expect(ids('visits')).toContain('v-due')
    expect(ids('visits')).not.toContain('v-ancient')
    expect(ids('visits')).not.toContain('v-old-pp')
    expect(ids('facilities').sort()).toEqual(['fac-0001', 'fac-0002', 'fac-0003', 'fac-0005']) // Savelugu district only

    // Resumable: stopping after two pages and continuing yields exactly the same set.
    const part = await pullAll(jwt, 37, 2)
    const rest: string[] = []
    let c = part.cursor
    for (let more = true; more; ) {
      const res = await pullAs(jwt, c, 37)
      rest.push(...res.body.records.map((r: Rec) => `${r.table}/${r.row.id}`))
      c = res.body.cursor
      more = res.body.more
    }
    expect([...part.seen, ...rest].sort()).toEqual([...seen].sort())

    // After the first sync, every change in the catchment is sent, active or not.
    await pushAs(jwt, [{ table: 'households', row: household() }])
    await write(prisma, (tx) => tx.client.update({ where: { id: 'old-child' }, data: { name: 'Old Child renamed', updatedAt: now + 1 } }))
    const next = await pullAs(jwt, cursor)
    expect(next.body.records.map((r: Rec) => `${r.table}/${r.row.id}`).sort()).toEqual(['clients/old-child', 'households/hh-new-1'])
    expect(next.body.records[0].row).not.toHaveProperty('seq')
  })

  it('sends rows in the wire format: snake_case keys, numbers, native JSON', async () => {
    const jwt = await activate('D001')
    const { body } = await pullAs(jwt)
    const client = body.records.find((r: Rec) => r.table === 'clients' && r.row.id === 'cl-0001').row
    expect(client).toMatchObject({ id: 'cl-0001', household_id: expect.any(String), facility_id: 'fac-0001', updated_at: expect.any(Number), prior_complications: expect.any(Array) })
    expect(Object.keys(client).every((k) => /^[a-z0-9_]+$/.test(k))).toBe(true)
  })

  it('scopes rows to the catchment and gives keys only to facility devices', async () => {
    const facility = await activate('F002', '0200000002')
    const theirs = await pullAs(facility)
    expect(theirs.body.records.some((r: { table: string }) => r.table === 'households')).toBe(false)
    expect(theirs.body.keys.D001).toBe(KEYS.D001)
    expect(theirs.body.records.find((r: { table: string }) => r.table === 'devices').row).not.toHaveProperty('key_hex')
  })
})
