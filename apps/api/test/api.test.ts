import { decode, encode } from '@laafia/core'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { db, write } from '../src/db.ts'
import { clients, households, jobs, referral_events, referrals, visits } from '../src/schema.ts'
import { DEMO_CODES } from '../src/seed.ts'
import { ADMIN, KEYS, SID, TODAY, activate, app, event, household, lfr, pullAs, pushAs, sms, useDb } from './helpers.ts'

useDb()

describe('sync push', () => {
  it('is idempotent: the same batch twice changes nothing the second time', async () => {
    const jwt = await activate('D001')
    const batch = [
      { table: 'households', row: household() },
      { table: 'clients', row: { id: 'cl-new-1', updated_at: 1_000, household_id: 'hh-new-1', code: 'CL-9001', type: 'pregnant', name: 'Test Mother', edd: TODAY, synced: 0 } },
    ]
    const first = await pushAs(jwt, batch)
    expect(first.body).toEqual({ accepted: ['hh-new-1', 'cl-new-1'], rejected: [] })
    const [before] = await db.select().from(households).where(eq(households.id, 'hh-new-1'))
    const second = await pushAs(jwt, batch)
    expect(second.body).toEqual(first.body)
    const [after] = await db.select().from(households).where(eq(households.id, 'hh-new-1'))
    expect(after).toEqual(before) // same seq: a no-op does not re-publish the row to pulls
    expect(after!.facility_id).toBe('fac-0001')
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
    const [row] = await db.select().from(households).where(eq(households.id, 'hh-new-1'))
    expect(row!.head_name).toBe('C')
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
  const base = { updated_at: now, device_id: 'seed', deleted: false, facility_id: 'fac-0001', household_id: 'hh-0001', prior_complications: [], risk_flags: [], nhis_active: false }

  it('sends a lean, resumable first sync: active clients, recent visits, district facilities', async () => {
    await write(async (tx) => {
      await tx.insert(clients).values([
        { ...base, id: 'old-pp', code: 'CL-0901', type: 'postpartum', name: 'Old PP', delivery_date: now - 100 * DAY },
        { ...base, id: 'old-child', code: 'CL-0902', type: 'child', name: 'Old Child', dob: now - 70 * 30 * DAY },
        { ...base, id: 'old-referred', code: 'CL-0903', type: 'child', name: 'Referred', dob: now - 70 * 30 * DAY },
        { ...base, id: 'old-followup', code: 'CL-0904', type: 'postpartum', name: 'Follow-up', delivery_date: now - 100 * DAY },
      ])
      await tx.insert(referrals).values({ id: 'r-open', updated_at: now, origin_device_id: 'D001', short_id: 'AAAAAAAA', client_id: 'old-referred', facility_id: 'fac-0001', status: 'sent' })
      const v = { updated_at: now, facility_id: 'fac-0001', protocol_id: 'maternal', rule_id: 'X', outcome: 'routine' as const }
      await tx.insert(visits).values([
        { ...v, id: 'v-due', client_id: 'old-followup', visited_at: now - 10 * DAY, outcome: 'followup', followup_due: now - DAY },
        { ...v, id: 'v-ancient', client_id: 'cl-0001', visited_at: now - 400 * DAY },
        { ...v, id: 'v-old-pp', client_id: 'old-pp', visited_at: now - 90 * DAY },
      ])
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
    expect(ids('facilities').sort()).toEqual(['fac-0001', 'fac-0002', 'fac-0003']) // Savelugu district only

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
    await write((tx) => tx.update(clients).set({ name: 'Old Child renamed', updated_at: now + 1 }).where(eq(clients.id, 'old-child')))
    const next = await pullAs(jwt, cursor)
    expect(next.body.records.map((r: Rec) => `${r.table}/${r.row.id}`).sort()).toEqual(['clients/old-child', 'households/hh-new-1'])
    expect(next.body.records[0].row).not.toHaveProperty('seq')
    expect(next.body.keys).toBeUndefined() // CHO devices never receive other keys
  })

  it('scopes rows to the catchment and gives keys only to facility devices', async () => {
    const facility = await activate('F002', '0200000002')
    const theirs = await pullAs(facility)
    expect(theirs.body.records.some((r: { table: string }) => r.table === 'households')).toBe(false)
    expect(theirs.body.keys.D001).toBe(KEYS.D001)
    expect(theirs.body.records.find((r: { table: string }) => r.table === 'devices').row).not.toHaveProperty('key_hex')
  })
})

describe('referrals', () => {
  it('merges an SMS-first referral with the later phone push onto one row', async () => {
    const res = await sms(encode(lfr, KEYS.D001!))
    expect(res.body).toMatchObject({ ok: true, kind: 'referral', duplicate: false })
    const [fromSms] = await db.select().from(referrals)
    expect(fromSms).toMatchObject({ origin_device_id: 'D001', short_id: SID, status: 'received', destination_facility_id: 'fac-0003', danger_signs: ['bleeding'] })

    // The gateway acknowledged with an LFS signed by the destination facility's phone.
    const [ack] = await db.select().from(jobs)
    expect(ack!.payload.to).toBe('0240000001')
    expect(decode(ack!.payload.body, (id) => KEYS[id])).toMatchObject({ ok: true, message: { kind: 'LFS', signer: 'F003', origin: 'D001', short_id: SID, status: 'R' } })

    expect((await sms(encode(lfr, KEYS.D001!))).body).toMatchObject({ ok: true, duplicate: true })
    expect((await sms(encode({ ...lfr, urgency: 1 }, KEYS.D001!))).body).toEqual({ ok: false, error: 'conflict' })

    const jwt = await activate('D001')
    const pushed = await pushAs(jwt, [
      { table: 'referrals', row: { id: 'r-uuid-1', updated_at: TODAY - 5_000, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0041', client_code: 'CL-0041', urgency: 3, danger_signs: ['bleeding'], destination_facility_id: 'fac-0003', status: 'closed' } },
      { table: 'referral_events', row: event({ status: 'sent' }) },
    ])
    expect(pushed.body).toEqual({ accepted: ['r-uuid-1', expect.any(String)], rejected: [] })
    const rows = await db.select().from(referrals)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'r-uuid-1', client_id: 'cl-0041', status: 'received' }) // pushed status ignored
    const events = await db.select().from(referral_events)
    expect(events.map((e) => e.status).sort()).toEqual(['received', 'sent'])
    expect(events.every((e) => e.referral_id === 'r-uuid-1')).toBe(true)
  })

  it('rejects a bad signature and an unknown signer', async () => {
    const body = encode(lfr, KEYS.D001!)
    expect((await sms(body.replace('|3|', '|1|'))).body).toEqual({ ok: false, error: 'bad_signature' })
    expect((await sms(encode(lfr, KEYS.V001!))).body).toEqual({ ok: false, error: 'bad_signature' })
    expect((await sms(encode({ ...lfr, signer: 'ZZ99' }, KEYS.D001!))).body).toEqual({ ok: false, error: 'unknown_signer' })
    expect((await sms('Hello, are you coming?')).body).toEqual({ ok: false, error: 'not_laafia' })
    expect(await db.select().from(referrals)).toHaveLength(0)
  })

  it('never regresses status whatever order events arrive in', async () => {
    const jwt = await activate('D001')
    await pushAs(jwt, [
      { table: 'referral_events', row: event({ status: 'arrived', via: 'sms' }) },
      { table: 'referral_events', row: event({ status: 'sent' }) },
    ])
    const [stub] = await db.select().from(referrals)
    expect(stub).toMatchObject({ id: 'r-uuid-1', status: 'arrived' })

    const web = await request(app).post('/referrals/r-uuid-1/status').set(ADMIN).send({ status: 'treated' })
    expect(web.body.referral.status).toBe('treated')
    const back = await request(app).post('/referrals/r-uuid-1/status').set(ADMIN).send({ status: 'received' })
    expect(back.body.referral.status).toBe('treated')
    // An LFS for a status behind the current one is also a no-op.
    await sms(encode({ kind: 'LFS', signer: 'F003', origin: 'D001', short_id: SID, status: 'R' }, KEYS.F003!))
    const [after] = await db.select().from(referrals)
    expect(after!.status).toBe('treated')
  })
})

describe('auth', () => {
  it('returns 401 deactivated after an admin deactivates the device, and drops its key', async () => {
    const jwt = await activate('D001')
    expect((await pullAs(jwt)).status).toBe(200)
    expect((await request(app).post('/admin/devices/D001/deactivate').set(ADMIN)).status).toBe(200)
    const res = await pullAs(jwt)
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('deactivated')
    expect((await request(app).post('/auth/refresh').set('Authorization', `Bearer ${jwt}`)).body.code).toBe('deactivated')
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
})
