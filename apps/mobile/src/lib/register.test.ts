/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FOLLOWUP_FLOOR, PROTOCOLS, evaluate, generateSeed } from '@laafia/core'
import { testDb } from '../../test/node-db'
import { createReferral, loadSeed, type Env } from './relay'
import { addProvider, enrol, facilityInbox, referralList, saveVisit, setProviderActive, todayList } from './register'

const DAY = 86_400_000
const TODAY = Date.UTC(2026, 9, 22, 8)
const seed = generateSeed(TODAY)

async function phone(id: string): Promise<Env & { tick: (ms: number) => void }> {
  const d = seed.devices.find((x) => x.id === id)!
  let clock = TODAY
  const env = {
    db: await testDb(),
    self: { device_id: d.id, role: d.role, key_hex: d.key_hex, phone: d.phone_number },
    now: () => clock, uuid: () => randomUUID(), random: (n: number) => new Uint8Array(randomBytes(n)),
    tick: (ms: number) => { clock += ms },
  }
  await loadSeed(env, seed)
  return env
}

describe('today list', () => {
  it('pins the day-old newborn first with reasons and orders the rest as a walk', async () => {
    const cho = await phone('D001')
    const list = await todayList(cho, { lat: 9.603, lng: -0.805 }, 12)
    expect(list[0]!.name).toMatch(/^Baby of Amina/)
    expect(list[0]!.pinned).toBe('newborn_48h')
    expect(list[0]!.reasons.length).toBeGreaterThan(0)
    expect(list).toHaveLength(12)
  })

  it('a follow-up visit brings the client back on the due date', async () => {
    const cho = await phone('D001')
    const child = seed.clients.find((c) => c.type === 'child')!
    await saveVisit(cho, { client_id: child.id, protocol_id: 'child', answers: { ch_muac: 120, age_months: 30 }, evaluation: evaluate(PROTOCOLS.child, { ch_muac: 120, age_months: 30 }), muac_mm: 120 })
    const visit = await cho.db.get<{ followup_due: number; outcome: string }>('SELECT followup_due, outcome FROM visits WHERE client_id = ? ORDER BY visited_at DESC', [child.id])
    expect(visit).toEqual({ followup_due: TODAY + 14 * DAY, outcome: 'followup' })
    cho.tick(14 * DAY)
    const row = (await todayList(cho, { lat: 9.603, lng: -0.805 }, 100)).find((r) => r.client_id === child.id)!
    expect(row.score).toBeGreaterThanOrEqual(FOLLOWUP_FLOOR)
  })
})

describe('enrolment', () => {
  it('creates a household and a client with a device-scoped code, unsynced', async () => {
    const cho = await phone('D001')
    const { client_id } = await enrol(cho, {
      household: { community: 'Moglaa', head_name: 'Naa Yakubu', landmark: 'near the borehole', lat: 9.66, lng: -0.87, consent: true },
      client: { type: 'pregnant', name: 'Sana Yakubu', sex: 'f', dob: null, edd: TODAY + 100 * DAY, delivery_date: null, parity: 1, prior_complications: [], birth_weight_g: null, nhis_active: true, next_of_kin: '0241112222' },
    })
    const c = await cho.db.get<{ code: string; synced: number }>('SELECT code, synced FROM clients WHERE id = ?', [client_id])
    expect(c!.code).toBe('CL-D001001')
    expect(c!.synced).toBe(0)
    expect(await cho.db.get('SELECT consent_at FROM households h JOIN clients c ON c.household_id = h.id WHERE c.id = ?', [client_id])).toEqual({ consent_at: TODAY })
  })

  it('refuses enrolment without recorded consent', async () => {
    const cho = await phone('D001')
    await expect(enrol(cho, {
      household: { community: 'Moglaa', head_name: 'X', landmark: '', lat: null, lng: null, consent: false },
      client: { type: 'child', name: 'Y', sex: 'm', dob: TODAY - 400 * DAY, edd: null, delivery_date: null, parity: null, prior_complications: [], birth_weight_g: null, nhis_active: false, next_of_kin: null },
    })).rejects.toThrow(/consent/)
  })
})

describe('transport providers', () => {
  it('registers a driver with a normalised number, unsynced, and can retire one', async () => {
    const cho = await phone('D001')
    const id = await addProvider(cho, { name: ' Alhassan Iddi ', phone: '+233 24 777 8888', vehicle: 'motor king', community: 'Diare' })
    expect(await cho.db.get('SELECT name, phone, active, synced FROM transport_providers WHERE id = ?', [id])).toEqual({ name: 'Alhassan Iddi', phone: '0247778888', active: 1, synced: 0 })
    await setProviderActive(cho, id, false)
    expect(await cho.db.get('SELECT active FROM transport_providers WHERE id = ?', [id])).toEqual({ active: 0 })
    await expect(addProvider(cho, { name: 'X', phone: '12', vehicle: '', community: '' })).rejects.toThrow(/phone/)
  })
})

describe('referral lists', () => {
  it('the facility inbox shows referrals to this facility, most urgent first, with plain-language signs', async () => {
    const hospital = await phone('F003')
    const cho = await phone('D001')
    const newborn = seed.clients.find((c) => c.name.startsWith('Baby of Amina'))!
    const { wire } = await createReferral(cho, { client_id: newborn.id, visit_id: null, protocol_id: 'young_infant', evaluation: evaluate(PROTOCOLS.young_infant, { yi_feeding: false }), destination_code: 'SAV-HOSP-01' })
    const { processIncoming } = await import('./relay')
    await processIncoming(hospital, { sender: cho.self.phone, body: wire, received_at: 1, via: 'sms' })
    const inbox = await facilityInbox(hospital)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ status: 'received', urgency: 3, signs: ['Not feeding well'], origin_name: 'Abiba Sulemana' })
    const mine = await referralList(cho)
    expect(mine[0]).toMatchObject({ status: 'created', client_name: newborn.name })
  })
})
