/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateSeed } from '@laafia/core'
import { testDb } from '../../test/node-db'
import { bookingRequests, confirmBooking, dayStart, declineBooking, scheduleVisit } from './bookings'
import { loadSeed, processIncoming, type Env } from './relay'
import { saveVisit, todayList } from './register'
import { PROTOCOLS, evaluate } from '@laafia/core'

const DAY = 86_400_000
const HOUR = 3_600_000
const TODAY = Date.UTC(2026, 9, 22, 9)
const seed = generateSeed(TODAY)
const origin = { lat: 9.603, lng: -0.805 }

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

const sms = (sender: string, body: string, received_at = 1) => ({ sender, body, received_at, via: 'sms' as const })
const child = seed.clients.find((c) => c.type === 'child')!

describe('booking by SMS', () => {
  it('takes a text from a registered client or a BOOK text as a request, and never stores personal SMS', async () => {
    const cho = await phone('D001')
    await cho.db.run('UPDATE clients SET phone = ? WHERE id = ?', ['0245556666', child.id])

    expect(await processIncoming(cho, sms('+233 24 555 6666', 'Please I want the nurse to come'))).toMatchObject({ kind: 'booking', isNew: true })
    expect(await processIncoming(cho, sms('0245556666', 'Tomorrow is better', 2))).toMatchObject({ kind: 'booking', isNew: false })
    expect(await processIncoming(cho, sms('0201112222', 'Book Ayishetu, Moglaa'))).toMatchObject({ kind: 'booking', isNew: true })
    expect(await processIncoming(cho, sms('0209999999', 'Hello dear, call me when you are free'))).toEqual({ kind: 'ignored' })

    const requests = await bookingRequests(cho)
    expect(requests.map((r) => [r.client_id, r.phone, r.message])).toEqual([
      [child.id, '0245556666', 'Tomorrow is better'],
      [null, '0201112222', 'Book Ayishetu, Moglaa'],
    ])
    expect(await cho.db.all('SELECT body FROM inbox WHERE sender = ?', ['0209999999'])).toHaveLength(0)

    const facility = await phone('F003')
    expect(await processIncoming(facility, sms('0201112222', 'BOOK me'))).toEqual({ kind: 'ignored' })
  })

  it('confirming texts the client now and the day before, and keeps her on Today from that day until she is seen', async () => {
    const cho = await phone('D001')
    await processIncoming(cho, sms('0201112222', 'BOOK please'))
    const [request] = await bookingRequests(cho)
    const day = dayStart(TODAY + 3 * DAY)
    await confirmBooking(cho, request!.id, { day, client_id: child.id })

    expect(await cho.db.get('SELECT phone FROM clients WHERE id = ?', [child.id])).toEqual({ phone: '0201112222' })
    const texts = await cho.db.all<{ recipient: string; body: string; next_attempt_at: number }>("SELECT recipient, body, next_attempt_at FROM outbox WHERE ref_table = 'appointments' ORDER BY next_attempt_at")
    expect(texts.map((t) => [t.recipient, t.next_attempt_at])).toEqual([['0201112222', TODAY], ['0201112222', day - DAY + 8 * HOUR]])
    expect(texts[0]!.body).toContain('Sun 25 Oct')
    expect(texts[1]!.body).toContain('tomorrow')

    expect((await todayList(cho, origin, 12)).find((r) => r.client_id === child.id)?.pinned).not.toBe('scheduled')
    cho.tick(3 * DAY)
    const row = (await todayList(cho, origin, 12)).find((r) => r.client_id === child.id)
    expect(row).toMatchObject({ pinned: 'scheduled' })
    expect(row!.reasons[0]!.text).toBe('Visit booked for today')

    cho.tick(DAY)
    expect((await todayList(cho, origin, 12)).find((r) => r.client_id === child.id)!.reasons[0]!.text).toBe('Booked visit missed')
    await saveVisit(cho, { client_id: child.id, protocol_id: 'child', answers: {}, evaluation: evaluate(PROTOCOLS.child, { age_months: 30 }) })
    expect((await todayList(cho, origin, 100)).find((r) => r.client_id === child.id)?.reasons.map((x) => x.text)).not.toContain('Booked visit missed')
  })

  it('a nurse schedules a visit herself; a new date replaces the old one and its reminder', async () => {
    const cho = await phone('D001')
    await cho.db.run('UPDATE clients SET phone = ? WHERE id = ?', ['0245556666', child.id])
    const first = await scheduleVisit(cho, child.id, dayStart(TODAY + 5 * DAY))
    await scheduleVisit(cho, child.id, dayStart(TODAY + 2 * DAY))
    expect(await cho.db.get('SELECT status FROM appointments WHERE id = ?', [first])).toEqual({ status: 'replaced' })
    const pending = await cho.db.all<{ body: string }>("SELECT body FROM outbox WHERE ref_table = 'appointments' AND status = 'pending'")
    // Texts for the replaced date that have not gone out yet are dropped: only the new confirmation and reminder remain.
    expect(pending).toHaveLength(2)
    expect(pending.every((p) => p.body.includes('Sat 24 Oct'))).toBe(true)
    expect(pending.filter((p) => p.body.includes('tomorrow'))).toHaveLength(1)
  })

  it('declining tells the client to call the nurse', async () => {
    const cho = await phone('D001')
    await processIncoming(cho, sms('0201112222', 'BOOK'))
    const [request] = await bookingRequests(cho)
    await declineBooking(cho, request!.id)
    expect(await bookingRequests(cho)).toHaveLength(0)
    expect(await cho.db.get("SELECT body FROM outbox WHERE ref_table = 'appointments'")).toEqual({ body: expect.stringContaining(cho.self.phone) })
  })
})
