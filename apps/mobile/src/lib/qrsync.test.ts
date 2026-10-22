/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PROTOCOLS, evaluate, generateSeed } from '@laafia/core'
import { testDb } from '../../test/node-db'
import { createReferral, loadSeed, referralStatus, type Env } from './relay'
import { enrol } from './register'
import { FRAME_BYTES, Receiver, buildFrames, encodeFrames } from './qrsync'

const TODAY = Date.UTC(2026, 9, 22, 8)
const seed = generateSeed(TODAY)

async function phone(id: string): Promise<Env> {
  const d = seed.devices.find((x) => x.id === id)!
  const env: Env = { db: await testDb(), self: { device_id: d.id, role: d.role, key_hex: d.key_hex, phone: d.phone_number }, now: () => TODAY, uuid: () => randomUUID(), random: (n) => new Uint8Array(randomBytes(n)) }
  await loadSeed(env, seed)
  return env
}

describe('record share by QR', () => {
  it('moves a volunteer enrolment and a referral to the CHO phone in small frames, in any scan order', async () => {
    const volunteer = await phone('V001')
    const cho = await phone('D001')
    const { client_id } = await enrol(volunteer, {
      household: { community: 'Diare', head_name: 'Naa Abukari', landmark: 'by the dam', lat: 9.68, lng: -0.76, consent: true },
      client: { type: 'pregnant', name: 'Hawa Abukari', sex: 'f', dob: null, edd: TODAY + 90 * 86_400_000, delivery_date: null, parity: 2, prior_complications: ['pph'], birth_weight_g: null, nhis_active: true, next_of_kin: null },
    })
    const sourceCho = await phone('D001')
    const newborn = seed.clients.find((c) => c.name.startsWith('Baby of Amina'))!
    const { referral } = await createReferral(sourceCho, { client_id: newborn.id, visit_id: null, protocol_id: 'young_infant', evaluation: evaluate(PROTOCOLS.young_infant, { yi_feeding: false }), destination_code: 'SAV-HOSP-01' })
    const sourceFrames = await buildFrames(sourceCho)

    const frames = await buildFrames(volunteer)
    expect(frames.length).toBeGreaterThan(0)
    expect(Math.max(...frames.map((f) => f.length))).toBeLessThanOrEqual(FRAME_BYTES + 64)

    const rx = new Receiver()
    for (const f of [...frames].reverse()) rx.add(f)
    rx.add(frames[0]!)
    expect(rx.progress()).toEqual({ have: frames.length, of: frames.length })
    const applied = await rx.apply(cho)
    expect(applied.rows).toBeGreaterThanOrEqual(2)
    const c = await cho.db.get<{ name: string; synced: number }>('SELECT name, synced FROM clients WHERE id = ?', [client_id])
    expect(c).toEqual({ name: 'Hawa Abukari', synced: 0 })

    const rx2 = new Receiver()
    for (const f of sourceFrames) rx2.add(f)
    await rx2.apply(volunteer)
    const carried = await volunteer.db.get<{ wire: string }>('SELECT wire FROM referrals WHERE id = ?', [referral.id])
    expect(carried!.wire.startsWith('LFR|')).toBe(true)
    expect(await referralStatus(volunteer, referral.id)).toBe('created')
  })

  it('rejects a corrupted frame set instead of writing half of it', async () => {
    const volunteer = await phone('V001')
    await enrol(volunteer, {
      household: { community: 'Diare', head_name: 'X', landmark: '', lat: null, lng: null, consent: true },
      client: { type: 'child', name: 'Yakubu', sex: 'm', dob: TODAY - 400 * 86_400_000, edd: null, delivery_date: null, parity: null, prior_complications: [], birth_weight_g: null, nhis_active: true, next_of_kin: null },
    })
    const frames = await buildFrames(volunteer)
    const rx = new Receiver()
    for (const f of frames) rx.add(f.replace(/\|([A-Za-z0-9+/=]{10})/, '|AAAAAAAAAA'))
    await expect(rx.apply(await phone('D001'))).rejects.toThrow(/checksum/)
  })

  it('refuses a payload that touches a server-owned or unknown table, writing nothing', async () => {
    const cho = await phone('D001')
    for (const table of ['devices', 'facilities', "clients SET name = 'x'; --"]) {
      const frames = encodeFrames(cho, [
        { table: 'households', row: { id: 'hh-evil', community: 'X', head_name: 'Y', landmark: '', lat: null, lng: null, consent_at: null, updated_at: TODAY + 1, device_id: 'V001', deleted: false } },
        { table, row: { id: 'D001', role: 'cho', user_name: 'x', phone_number: '0249999999', active: true } },
      ])
      const rx = new Receiver()
      for (const f of frames) rx.add(f)
      await expect(rx.apply(cho)).rejects.toThrow(/not allowed/)
    }
    expect(await cho.db.get("SELECT id FROM households WHERE id = 'hh-evil'")).toBeUndefined()
    expect(await cho.db.get("SELECT phone_number FROM devices WHERE id = 'D001'")).toEqual({ phone_number: '0240000001' })
  })

  it('ignores frames from a different share and junk', () => {
    const rx = new Receiver()
    expect(rx.add('hello')).toBe(false)
    expect(rx.add('LFQ|1|ABCDEF|0|2|eA==|00000000')).toBe(true)
    expect(rx.add('LFQ|1|ZZZZZZ|0|2|eA==|00000000')).toBe(false)
  })
})
