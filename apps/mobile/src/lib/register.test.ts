/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FOLLOWUP_FLOOR, PROTOCOLS, evaluate, generateSeed } from '@laafia/core'
import { testDb } from '../../test/node-db'
import { createReferral, loadSeed, type Env } from './relay'
import { enrol, facilityInbox, possibleDuplicates, recordDelivery, referralList, saveVisit, todayList, updateClient } from './register'

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
    // The cap is the whole day: pinned clients always stay, routine ones fill what is left of it.
    expect(list).toHaveLength(12)
    expect(list.filter((r) => r.pinned).length).toBeGreaterThan(0)
    expect((await todayList(cho, { lat: 9.603, lng: -0.805 }, 17))).toHaveLength(17)
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

describe('visited today', () => {
  const origin = { lat: 9.603, lng: -0.805 }
  const visit = async (cho: Env, clientId: string, answers: Record<string, unknown>) => {
    const c = seed.clients.find((x) => x.id === clientId)!
    const protocol = c.type === 'newborn' ? 'young_infant' : c.type === 'child' ? 'child' : 'maternal'
    const evaluation = evaluate(PROTOCOLS[protocol], answers)
    const visitId = await saveVisit(cho, { client_id: c.id, protocol_id: protocol, answers, evaluation, muac_mm: null })
    return { evaluation, visitId, protocol } as const
  }

  it('stays on the list at the end, marked with how the visit ended, and the day does not refill', async () => {
    const cho = await phone('D001')
    const before = await todayList(cho, origin, 12)
    const routine = before.find((r) => !r.pinned)!
    await visit(cho, routine.client_id, {})
    cho.tick(60_000)
    const after = await todayList(cho, origin, 12)
    expect(after).toHaveLength(before.length)
    expect(after.at(-1)).toMatchObject({ client_id: routine.client_id, done: { outcome: 'routine' } })
    expect(after.filter((r) => !r.done).map((r) => r.client_id)).not.toContain(routine.client_id)
  })

  it('a client referred today is done, not pinned back on top as an open referral', async () => {
    const cho = await phone('D001')
    const baby = (await todayList(cho, origin, 12))[0]!
    const { evaluation, visitId, protocol } = await visit(cho, baby.client_id, { yi_feeding: false, yi_breaths: 66 })
    await createReferral(cho, { client_id: baby.client_id, visit_id: visitId, protocol_id: protocol, evaluation, destination_code: 'SAV-HOSP-01' })
    const row = (await todayList(cho, origin, 12)).find((r) => r.client_id === baby.client_id)!
    expect(row).toMatchObject({ pinned: null, done: { outcome: 'refer' } })
  })

  it('the follow-up a discharge schedules is not a visit', async () => {
    const cho = await phone('D001')
    const someone = (await todayList(cho, origin, 12)).find((r) => !r.pinned)!
    await cho.db.run("INSERT INTO visits (id, client_id, protocol_id, protocol_version, visited_at, answers, outcome, rule_id, followup_due, updated_at, device_id) VALUES ('auto', ?, 'child', 1, ?, '{}', 'followup', 'REFERRAL-CLOSED', ?, ?, 'D001')",
      [someone.client_id, TODAY, TODAY + 3 * DAY, TODAY])
    const row = (await todayList(cho, origin, 12)).find((r) => r.client_id === someone.client_id)
    expect(row?.done ?? null).toBeNull()
  })
})

describe('scheduled visits', () => {
  it('keeps everyone scheduled for today on the list, past the daily cap', async () => {
    const cho = await phone('D001')
    const child = seed.clients.find((c) => c.type === 'child' && c.name !== 'x')!
    await cho.db.run("INSERT INTO visits (id, client_id, protocol_id, protocol_version, visited_at, answers, outcome, rule_id, followup_due, updated_at, device_id) VALUES ('vs', ?, 'child', 1, ?, '{}', 'followup', 'X', ?, ?, 'D001')",
      [child.id, TODAY - 5 * DAY, TODAY + 6 * 3_600_000, TODAY])
    const list = await todayList(cho, { lat: 9.603, lng: -0.805 }, 1)
    expect(list.find((r) => r.client_id === child.id)).toMatchObject({ pinned: 'scheduled' })
  })
})

describe('editing a client', () => {
  it("saves her name, phone, next of kin and house details for the next sync, and refuses a bad number", async () => {
    const cho = await phone('D001')
    const c = seed.clients[0]!
    await updateClient(cho, c.id, { name: ' Amina Iddrisu ', phone: '+233 24 555 6666', next_of_kin: '', community: 'Moglaa', head_name: 'Naa Iddrisu', landmark: 'blue gate' })
    expect(await cho.db.get('SELECT name, phone, next_of_kin, synced FROM clients WHERE id = ?', [c.id])).toEqual({ name: 'Amina Iddrisu', phone: '0245556666', next_of_kin: null, synced: 0 })
    expect(await cho.db.get('SELECT community, head_name, landmark, synced FROM households WHERE id = ?', [c.household_id])).toEqual({ community: 'Moglaa', head_name: 'Naa Iddrisu', landmark: 'blue gate', synced: 0 })
    await expect(updateClient(cho, c.id, { name: 'X', phone: '12345', next_of_kin: '', community: 'Moglaa', head_name: 'H', landmark: '' })).rejects.toThrow(/phone/)
    await expect(updateClient(cho, c.id, { name: '  ', phone: '', next_of_kin: '', community: 'Moglaa', head_name: 'H', landmark: '' })).rejects.toThrow(/name/)
    // The house needs what enrolment needs: where it is and whose it is.
    await expect(updateClient(cho, c.id, { name: 'Amina', phone: '', next_of_kin: '', community: ' ', head_name: 'H', landmark: '' })).rejects.toThrow(/community/)
    await expect(updateClient(cho, c.id, { name: 'Amina', phone: '', next_of_kin: '', community: 'Moglaa', head_name: '', landmark: '' })).rejects.toThrow(/head of household/)
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

  it('finds who may already be on the register: the same phone, or the same name and type', async () => {
    const cho = await phone('D001')
    const someone = seed.clients.find((c) => c.type === 'pregnant')!
    await cho.db.run("UPDATE clients SET phone = '0241234567' WHERE id = ?", [someone.id])
    const byName = await possibleDuplicates(cho, { name: `  ${someone.name.toUpperCase()} `, type: 'pregnant', phone: null })
    expect(byName.map((m) => m.id)).toEqual([someone.id])
    expect(byName[0]!.why).toBe('same name')
    expect((await possibleDuplicates(cho, { name: 'Someone Else', type: 'child', phone: '+233 24 123 4567' }))[0]).toMatchObject({ id: someone.id, why: 'same phone' })
    expect(await possibleDuplicates(cho, { name: someone.name, type: 'child', phone: null })).toEqual([])
  })

  it('refuses enrolment without recorded consent', async () => {
    const cho = await phone('D001')
    await expect(enrol(cho, {
      household: { community: 'Moglaa', head_name: 'X', landmark: '', lat: null, lng: null, consent: false },
      client: { type: 'child', name: 'Y', sex: 'm', dob: TODAY - 400 * DAY, edd: null, delivery_date: null, parity: null, prior_complications: [], birth_weight_g: null, nhis_active: false, next_of_kin: null },
    })).rejects.toThrow(/consent/)
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

describe('recording a delivery', () => {
  const day = Math.floor(TODAY / DAY) * DAY
  const pregnant = () => seed.clients.find((c) => c.type === 'pregnant')!

  it('makes the mother a postpartum client and enrols each baby as a newborn in her household', async () => {
    const cho = await phone('D001')
    const mother = pregnant()
    const { babies } = await recordDelivery(cho, mother.id, { date: day, outcome: 'live', babies: [{ name: 'Baby of Ama 1', sex: 'f', birth_weight_g: 2400 }, { name: 'Baby of Ama 2', sex: 'm', birth_weight_g: null }] })
    expect(babies).toHaveLength(2)
    const m = await cho.db.get<{ type: string; delivery_date: number; parity: number | null; synced: number }>('SELECT type, delivery_date, parity, synced FROM clients WHERE id = ?', [mother.id])
    expect(m).toEqual({ type: 'postpartum', delivery_date: day, parity: (mother.parity ?? 0) + 1, synced: 0 })
    const kids = await cho.db.all<{ type: string; dob: number; household_id: string; sex: string; birth_weight_g: number | null; code: string }>(`SELECT type, dob, household_id, sex, birth_weight_g, code FROM clients WHERE id IN (${babies.map(() => '?').join(',')}) ORDER BY name`, babies)
    expect(kids.map((k) => [k.type, k.dob, k.household_id, k.sex, k.birth_weight_g])).toEqual([['newborn', day, mother.household_id, 'f', 2400], ['newborn', day, mother.household_id, 'm', null]])
    expect(new Set(kids.map((k) => k.code)).size).toBe(2)
    // Newborns are pinned for a visit within 48 hours.
    const today = await todayList(cho, { lat: 9.603, lng: -0.805 }, 12)
    expect(today.filter((r) => babies.includes(r.client_id)).every((r) => r.pinned === 'newborn_48h')).toBe(true)
  })

  it('records a stillbirth in her history without enrolling a baby', async () => {
    const cho = await phone('D001')
    const mother = pregnant()
    expect((await recordDelivery(cho, mother.id, { date: day - 2 * DAY, outcome: 'stillbirth', babies: [] })).babies).toEqual([])
    const m = await cho.db.get<{ type: string; prior_complications: string }>('SELECT type, prior_complications FROM clients WHERE id = ?', [mother.id])
    expect(m!.type).toBe('postpartum')
    expect(JSON.parse(m!.prior_complications)).toContain('stillbirth')
  })

  it('refuses a future date, a client who is not pregnant, and a live birth without a baby', async () => {
    const cho = await phone('D001')
    const mother = pregnant()
    await expect(recordDelivery(cho, mother.id, { date: day + DAY, outcome: 'live', babies: [{ name: 'B', sex: 'f', birth_weight_g: null }] })).rejects.toThrow(/future/)
    await expect(recordDelivery(cho, mother.id, { date: day, outcome: 'live', babies: [] })).rejects.toThrow(/baby/)
    const child = seed.clients.find((c) => c.type === 'child')!
    await expect(recordDelivery(cho, child.id, { date: day, outcome: 'live', babies: [{ name: 'B', sex: 'f', birth_weight_g: null }] })).rejects.toThrow(/pregnant/)
  })
})
