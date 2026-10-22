/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PROTOCOLS, evaluate, generateSeed } from '@laafia/core'
import { testDb } from '../../test/node-db'
import { createReferral, loadSeed, processIncoming, type Env } from './relay'
import { saveVisit } from './register'
import { monthlyReport, reportHtml } from './report'

const TODAY = Date.UTC(2026, 9, 22, 9)
const seed = generateSeed(TODAY)

async function phone(id: string): Promise<Env> {
  const d = seed.devices.find((x) => x.id === id)!
  const env = {
    db: await testDb(),
    self: { device_id: d.id, role: d.role, key_hex: d.key_hex, phone: d.phone_number },
    now: () => TODAY, uuid: () => randomUUID(), random: (n: number) => new Uint8Array(randomBytes(n)),
  }
  await loadSeed(env, seed)
  return env
}

describe('monthly report', () => {
  it("counts the nurse's own visits and referrals for the month, leaving out other months and follow-up stubs", async () => {
    const cho = await phone('D001')
    const newborn = seed.clients.find((c) => c.name.startsWith('Baby of Amina'))!
    const child = seed.clients.find((c) => c.type === 'child')!
    const ev = evaluate(PROTOCOLS.young_infant, { yi_feeding: false })
    const visitId = await saveVisit(cho, { client_id: newborn.id, protocol_id: 'young_infant', answers: { yi_feeding: false }, evaluation: ev })
    await createReferral(cho, { client_id: newborn.id, visit_id: visitId, protocol_id: 'young_infant', evaluation: ev, destination_code: 'SAV-HOSP-01' })
    await saveVisit(cho, { client_id: child.id, protocol_id: 'child', answers: {}, evaluation: evaluate(PROTOCOLS.child, { age_months: 30 }) })
    await cho.db.run("UPDATE visits SET visited_at = ? WHERE client_id = ?", [Date.UTC(2026, 8, 30), child.id])

    const r = await monthlyReport(cho, Date.UTC(2026, 9, 1))
    expect(r.month).toBe('October 2026')
    expect(r.nurse).toBe('Abiba Sulemana')
    expect(r.visits.map((v) => [v.code, v.outcome])).toEqual([[newborn.code, 'Refer']])
    expect(r.totals).toMatchObject({ visits: 1, refer: 1, followup: 0, routine: 0, referrals: 1, referrals_closed: 0 })
    expect(r.referrals[0]).toMatchObject({ code: newborn.code, place: 'Savelugu Municipal Hospital', status: 'Not sent yet' })
    expect((await monthlyReport(cho, Date.UTC(2026, 8, 1))).totals.visits).toBe(1)
  })

  it('lists the referrals a facility received, and escapes names in the printable page', async () => {
    const cho = await phone('D001')
    const hospital = await phone('F003')
    const newborn = seed.clients.find((c) => c.name.startsWith('Baby of Amina'))!
    const { wire } = await createReferral(cho, { client_id: newborn.id, visit_id: null, protocol_id: 'young_infant', evaluation: evaluate(PROTOCOLS.young_infant, { yi_feeding: false }), destination_code: 'SAV-HOSP-01' })
    await processIncoming(hospital, { sender: cho.self.phone, body: wire, received_at: TODAY, via: 'sms' })
    await hospital.db.run("UPDATE clients SET name = '<b>Amina</b>' WHERE id = ?", [newborn.id])

    const r = await monthlyReport(hospital, Date.UTC(2026, 9, 1))
    expect(r.referrals).toHaveLength(1)
    expect(r.referrals[0]).toMatchObject({ place: 'Abiba Sulemana', status: 'Facility received it' })
    const html = reportHtml(r)
    expect(html).toContain('&lt;b&gt;Amina&lt;/b&gt;')
    expect(html).not.toContain('<b>Amina</b>')
    expect(html).toContain('Referrals received')
  })
})
