/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PROTOCOLS, evaluate, generateSeed } from '@laafia/core'
import { testDb } from '../../test/node-db'
import { createReferral, loadSeed, processIncoming, referralStatus, type Env } from './relay'
import { pull, push, type Api } from './sync'

const TODAY = Date.UTC(2026, 9, 22, 8)
const seed = generateSeed(TODAY)

async function phone(deviceId: string): Promise<Env> {
  const d = seed.devices.find((x) => x.id === deviceId)!
  const env: Env = {
    db: await testDb(),
    self: { device_id: d.id, role: d.role, key_hex: d.key_hex, phone: d.phone_number },
    now: () => TODAY,
    uuid: () => randomUUID(),
    random: (n) => new Uint8Array(randomBytes(n)),
  }
  await loadSeed(env, seed)
  await env.db.run('UPDATE households SET synced = 1')
  return env
}

const newborn = seed.clients.find((c) => c.name.startsWith('Baby of Amina'))!
const refer = (env: Env) =>
  createReferral(env, {
    client_id: newborn.id, visit_id: null, protocol_id: 'young_infant',
    evaluation: evaluate(PROTOCOLS.young_infant, { yi_feeding: false }), destination_code: 'SAV-HOSP-01',
  })

type Pushed = { table: string; row: Record<string, unknown> }

function fakeApi(handlers: { push?: (records: Pushed[]) => { accepted: string[]; rejected: { id: string; table: string; reason: string }[] }; pages?: unknown[] }): Api & { pushed: Pushed[][]; pulls: (string | undefined)[] } {
  const pushed: Pushed[][] = []
  const pulls: (string | undefined)[] = []
  let page = 0
  return {
    pushed,
    pulls,
    async request(method, path, body) {
      if (method === 'POST' && path === '/sync/push') {
        const records = (body as { records: Pushed[] }).records
        pushed.push(records)
        return handlers.push ? handlers.push(records) : { accepted: records.map((r) => r.row.id as string), rejected: [] }
      }
      if (method === 'GET' && path.startsWith('/sync/pull')) {
        pulls.push(new URL('http://x' + path).searchParams.get('since') ?? undefined)
        return handlers.pages?.[page++] ?? { records: [], cursor: 'end', more: false }
      }
      throw new Error(`unexpected ${method} ${path}`)
    },
  }
}

describe('push', () => {
  it('sends referrals in the server shape, events with their referral key, and marks accepted rows synced', async () => {
    const cho = await phone('D001')
    const { referral } = await refer(cho)
    const api = fakeApi({})
    await push(cho, api)

    const records = api.pushed.flat()
    const r = records.find((x) => x.table === 'referrals')!.row
    expect(r).toMatchObject({ id: referral.id, origin_device_id: 'D001', short_id: referral.short_id, client_type: 'newborn', danger_signs: ['not_feeding'], destination_facility_id: 'fac-0003', deleted: false })
    expect(r.lfr).toBeUndefined()
    const e = records.find((x) => x.table === 'referral_events')!.row
    expect(e).toMatchObject({ referral_id: referral.id, origin_device_id: 'D001', short_id: referral.short_id, status: 'created' })
    expect(records.findIndex((x) => x.table === 'referrals')).toBeLessThan(records.findIndex((x) => x.table === 'referral_events'))
    expect(await cho.db.all('SELECT id FROM referrals WHERE synced = 0')).toHaveLength(0)
  })

  it('a carrier pushes the origin LFR; unknown_referral stays pending, permanent rejections stop retrying', async () => {
    const cho = await phone('D001')
    const volunteer = await phone('V001')
    const { wire } = await refer(cho)
    await processIncoming(volunteer, { sender: 'qr', body: wire, received_at: 1, via: 'qr' })

    const api = fakeApi({
      push: (records) => ({
        accepted: [],
        rejected: records.map((x) => ({ id: x.row.id as string, table: x.table, reason: x.table === 'referral_events' ? 'unknown_referral' : 'invalid: urgency' })),
      }),
    })
    await push(volunteer, api)
    expect(api.pushed.flat().find((x) => x.table === 'referrals')!.row.lfr).toBe(wire)
    expect(await volunteer.db.get('SELECT synced FROM referrals')).toEqual({ synced: -1 })
    expect(await volunteer.db.get('SELECT synced FROM referral_events')).toEqual({ synced: 0 })
  })

  it('sends at most 200 records per request', async () => {
    const cho = await phone('D001')
    await cho.db.run('UPDATE clients SET synced = 0')
    await cho.db.run('UPDATE visits SET synced = 0')
    for (let i = 0; i < 150; i++) {
      await cho.db.run("INSERT INTO households (id, community, head_name, landmark, updated_at, device_id) VALUES (?, 'X', 'Y', '', 1, 'D001')", [`new-${i}`])
    }
    const api = fakeApi({})
    await push(cho, api)
    expect(api.pushed.length).toBeGreaterThan(1)
    expect(Math.max(...api.pushed.map((b) => b.length))).toBeLessThanOrEqual(200)
    expect(await cho.db.all('SELECT id FROM households WHERE synced = 0')).toHaveLength(0)
  })
})

describe('pull', () => {
  it('follows pages, stores the cursor after each, and resumes from it', async () => {
    const cho = await phone('D001')
    const api = fakeApi({
      pages: [
        { records: [{ table: 'households', row: { id: 'hh-new', community: 'Diare', head_name: 'Naa Issah', landmark: 'by the dam', lat: null, lng: null, consent_at: null, updated_at: TODAY, device_id: 'import', deleted: false } }], cursor: 'c1', more: true },
        { records: [], cursor: 'c2', more: false },
      ],
    })
    await pull(cho, api)
    expect(api.pulls).toEqual([undefined, 'c1'])
    expect(await cho.db.get("SELECT value FROM meta WHERE key = 'sync_cursor'")).toEqual({ value: 'c2' })
    expect(await cho.db.get("SELECT head_name FROM households WHERE id = 'hh-new'")).toEqual({ head_name: 'Naa Issah' })

    const again = fakeApi({})
    await pull(cho, again)
    expect(again.pulls).toEqual(['c2'])
  })

  it('keeps a newer unsynced local edit, and applies a soft delete', async () => {
    const cho = await phone('D001')
    const c = seed.clients[0]!
    await cho.db.run('UPDATE clients SET name = ?, updated_at = ?, synced = 0 WHERE id = ?', ['Local edit', TODAY + 10, c.id])
    const row = (over: object) => ({ ...c, prior_complications: [], risk_flags: [], nhis_active: true, device_id: 'import', deleted: false, ...over })
    await pull(cho, fakeApi({ pages: [{ records: [{ table: 'clients', row: row({ name: 'Older server', updated_at: TODAY + 5 }) }, { table: 'clients', row: row({ id: seed.clients[1]!.id, household_id: seed.clients[1]!.household_id, code: seed.clients[1]!.code, updated_at: TODAY + 20, deleted: true }) }], cursor: 'c', more: false }] }))
    expect(await cho.db.get('SELECT name FROM clients WHERE id = ?', [c.id])).toEqual({ name: 'Local edit' })
    expect(await cho.db.get('SELECT deleted FROM clients WHERE id = ?', [seed.clients[1]!.id])).toEqual({ deleted: 1 })
  })

  it('adopts the server id for a referral it first created from an SMS, and its events follow', async () => {
    const cho = await phone('D001')
    const hospital = await phone('F003')
    const { referral, wire } = await refer(cho)
    await processIncoming(hospital, { sender: cho.self.phone, body: wire, received_at: 1, via: 'sms' })
    const local = await hospital.db.get<{ id: string }>('SELECT id FROM referrals')
    expect(local!.id).not.toBe(referral.id)

    await pull(hospital, fakeApi({
      pages: [{
        records: [{ table: 'referrals', row: { id: referral.id, origin_device_id: 'D001', short_id: referral.short_id, client_id: newborn.id, visit_id: null, client_code: newborn.code, client_type: 'newborn', context: 'PP1', urgency: 3, danger_signs: ['not_feeding'], destination_facility_id: 'fac-0003', next_of_kin: null, status: 'received', updated_at: TODAY + 1, device_id: 'D001', deleted: false } }],
        cursor: 'c', more: false,
      }],
    }))
    expect(await hospital.db.all('SELECT id FROM referrals')).toEqual([{ id: referral.id }])
    expect(await referralStatus(hospital, referral.id)).toBe('received')
    expect(await hospital.db.all('SELECT id FROM referral_events WHERE referral_id = ?', [local!.id])).toHaveLength(0)
  })

  it('replaces the key directory when the server sends one', async () => {
    const hospital = await phone('F003')
    await pull(hospital, fakeApi({ pages: [{ records: [], cursor: 'c', more: false, keys: { D001: 'ab'.repeat(32) } }] }))
    expect(await hospital.db.get("SELECT key_hex FROM devices WHERE id = 'D001'")).toEqual({ key_hex: 'ab'.repeat(32) })
    expect(await hospital.db.get("SELECT key_hex FROM devices WHERE id = 'V001'")).toEqual({ key_hex: null })
  })
})
