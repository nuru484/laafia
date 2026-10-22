/// <reference types="node" />
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PROTOCOLS, SMS_SEGMENT, evaluate, generateSeed, parse } from '@laafia/core'
import { testDb } from '../../test/node-db'
import {
  applySendResult,
  createReferral,
  dueMessages,
  loadSeed,
  markSending,
  processIncoming,
  referralStatus,
  requestTransport,
  type Env,
} from './relay'

const TODAY = Date.UTC(2026, 9, 22, 8)
const seed = generateSeed(TODAY)
const dev = (id: string) => seed.devices.find((d) => d.id === id)!

async function phone(deviceId: string, start = TODAY): Promise<Env & { tick: (ms: number) => void }> {
  const d = dev(deviceId)
  let clock = start
  const env = {
    db: await testDb(),
    self: { device_id: d.id, role: d.role, key_hex: d.key_hex, phone: d.phone_number },
    now: () => clock,
    uuid: () => randomUUID(),
    random: (n: number) => new Uint8Array(randomBytes(n)),
    tick: (ms: number) => { clock += ms },
  }
  await loadSeed(env, seed)
  return env
}

const newborn = seed.clients.find((c) => c.type === 'newborn' && c.name.startsWith('Baby of Amina'))!

async function referNewborn(cho: Env) {
  const evaluation = evaluate(PROTOCOLS.young_infant, { yi_feeding: false, yi_breaths: 66 })
  return createReferral(cho, { client_id: newborn.id, visit_id: null, protocol_id: 'young_infant', evaluation, destination_code: 'SAV-HOSP-01' })
}

/** Hand the latest queued SMS to the radio and report it sent, as the native module would. */
async function radioSends(env: Env) {
  const [msg] = await dueMessages(env)
  if (!msg) throw new Error('nothing due')
  await markSending(env, msg.id, 0)
  await applySendResult(env, { id: msg.id, status: 'sent', error: null, at: env.now() })
  return msg
}

describe('referral relay over SMS', () => {
  it('CHO refers, facility verifies and acknowledges, CHO sees received', async () => {
    const cho = await phone('D001')
    const hospital = await phone('F003')

    const { referral } = await referNewborn(cho)
    expect(await referralStatus(cho, referral.id)).toBe('created')

    const sms = await radioSends(cho)
    expect(sms.recipient).toBe('0200000003')
    expect(sms.body.length).toBeLessThanOrEqual(SMS_SEGMENT)
    expect(await referralStatus(cho, referral.id)).toBe('sent')

    const received = await processIncoming(hospital, { sender: cho.self.phone, body: sms.body, received_at: hospital.now(), via: 'sms' })
    expect(received).toMatchObject({ kind: 'referral', isNew: true })
    const atHospital = await hospital.db.get<{ id: string; client_code: string; sign_codes: string }>('SELECT * FROM referrals')
    expect(atHospital).toMatchObject({ client_code: newborn.code })
    expect(JSON.parse(atHospital!.sign_codes)).toEqual(['nf', 'fb'])
    expect(await referralStatus(hospital, atHospital!.id)).toBe('received')

    const ack = await radioSends(hospital)
    expect(ack.recipient).toBe(cho.self.phone)
    expect(parse(ack.body)?.message).toMatchObject({ kind: 'LFS', status: 'R', origin: 'D001', short_id: referral.short_id })

    expect(await processIncoming(cho, { sender: hospital.self.phone, body: ack.body, received_at: cho.now(), via: 'sms' })).toMatchObject({ kind: 'status' })
    expect(await referralStatus(cho, referral.id)).toBe('received')
  })

  it('rejects a tampered referral and an unknown signer without creating anything', async () => {
    const cho = await phone('D001')
    const hospital = await phone('F003')
    await referNewborn(cho)
    const sms = await radioSends(cho)

    const tampered = sms.body.replace('|3|', '|1|')
    expect(await processIncoming(hospital, { sender: cho.self.phone, body: tampered, received_at: 1, via: 'sms' })).toEqual({ kind: 'rejected', error: 'bad_signature' })
    await hospital.db.run("UPDATE devices SET active = 0 WHERE id = 'D001'")
    expect(await processIncoming(hospital, { sender: cho.self.phone, body: sms.body, received_at: 2, via: 'sms' })).toEqual({ kind: 'rejected', error: 'unknown_signer' })
    expect(await hospital.db.all('SELECT * FROM referrals')).toHaveLength(0)
    expect(await dueMessages(hospital)).toHaveLength(0)
  })

  it('a duplicate copy is a confirmation: one referral, re-acknowledged only after two minutes', async () => {
    const cho = await phone('D001')
    const hospital = await phone('F003')
    await referNewborn(cho)
    const sms = await radioSends(cho)

    await processIncoming(hospital, { sender: cho.self.phone, body: sms.body, received_at: 1, via: 'sms' })
    await radioSends(hospital)
    expect(await processIncoming(hospital, { sender: cho.self.phone, body: sms.body, received_at: 2, via: 'sms' })).toMatchObject({ kind: 'referral', isNew: false })
    expect(await dueMessages(hospital)).toHaveLength(0)

    hospital.tick(3 * 60_000)
    await processIncoming(hospital, { sender: cho.self.phone, body: sms.body, received_at: 3, via: 'sms' })
    expect(await dueMessages(hospital)).toHaveLength(1)
    expect(await hospital.db.all('SELECT * FROM referrals')).toHaveLength(1)
  })

  it('ignores ordinary SMS and the same raw message drained twice', async () => {
    const hospital = await phone('F003')
    expect(await processIncoming(hospital, { sender: '0249999999', body: 'Hello, call me', received_at: 1, via: 'sms' })).toEqual({ kind: 'ignored' })
    const cho = await phone('D001')
    await referNewborn(cho)
    const sms = await radioSends(cho)
    const raw = { sender: cho.self.phone, body: sms.body, received_at: 5, via: 'sms' as const }
    await processIncoming(hospital, raw)
    expect(await processIncoming(hospital, raw)).toEqual({ kind: 'duplicate' })
  })
})

describe('QR hop', () => {
  it('a volunteer carries the signed referral and forwards it; the facility verifies the CHO signature from the volunteer SIM', async () => {
    const cho = await phone('D001')
    const volunteer = await phone('V001')
    // Volunteers hold no keys: a lost volunteer phone must not be able to sign referrals.
    await volunteer.db.run('UPDATE devices SET key_hex = NULL')
    const hospital = await phone('F003')
    const { wire } = await referNewborn(cho)

    expect(await processIncoming(volunteer, { sender: 'qr', body: wire, received_at: 1, via: 'qr' })).toMatchObject({ kind: 'referral', isNew: true })
    const carried = await volunteer.db.get<{ id: string }>('SELECT id FROM referrals')
    expect(await referralStatus(volunteer, carried!.id)).toBe('carrying')

    const forward = await radioSends(volunteer)
    expect(forward).toMatchObject({ recipient: '0200000003', body: wire })

    expect(await processIncoming(hospital, { sender: volunteer.self.phone, body: forward.body, received_at: 2, via: 'sms' })).toMatchObject({ kind: 'referral', isNew: true })
    const ack = await radioSends(hospital)
    expect(ack.recipient).toBe(cho.self.phone)
  })
})

describe('escalation', () => {
  it('resends the same signed referral to a backup number, so the facility still dedupes it', async () => {
    const cho = await phone('D001')
    const { referral, wire } = await referNewborn(cho)
    await radioSends(cho)
    const { resendReferral } = await import('./relay')
    await resendReferral(cho, referral.id, '024 555 0000')
    const [again] = await dueMessages(cho)
    expect(again).toMatchObject({ recipient: '0245550000', body: wire, ref_id: referral.id })
  })
})

describe('closing the loop', () => {
  it('when the facility closes the referral, the CHO gets a follow-up due in 3 days', async () => {
    const cho = await phone('D001')
    const hospital = await phone('F003')
    const { referral } = await referNewborn(cho)
    const sms = await radioSends(cho)
    await processIncoming(hospital, { sender: cho.self.phone, body: sms.body, received_at: 1, via: 'sms' })
    await radioSends(hospital)
    const atHospital = await hospital.db.get<{ id: string }>('SELECT id FROM referrals')
    const { facilityUpdate } = await import('./relay')
    await facilityUpdate(hospital, atHospital!.id, 'closed')
    const close = await radioSends(hospital)
    await processIncoming(cho, { sender: hospital.self.phone, body: close.body, received_at: 2, via: 'sms' })
    expect(await referralStatus(cho, referral.id)).toBe('closed')
    const stub = await cho.db.get<{ client_id: string; followup_due: number; rule_id: string }>("SELECT client_id, followup_due, rule_id FROM visits WHERE rule_id = 'REFERRAL-CLOSED'")
    expect(stub).toEqual({ client_id: newborn.id, followup_due: cho.now() + 3 * 86_400_000, rule_id: 'REFERRAL-CLOSED' })
    await processIncoming(cho, { sender: hospital.self.phone, body: close.body, received_at: 3, via: 'sms' })
    expect(await cho.db.all("SELECT id FROM visits WHERE rule_id = 'REFERRAL-CLOSED'")).toHaveLength(1)
  })
})

describe('status authority', () => {
  it('ignores a validly signed status update that does not come from a facility device', async () => {
    const cho = await phone('D001')
    const { referral } = await referNewborn(cho)
    const { encode } = await import('@laafia/core')
    const forged = encode({ kind: 'LFS', signer: 'V001', origin: 'D001', short_id: referral.short_id, status: 'T' }, dev('V001').key_hex)
    expect(await processIncoming(cho, { sender: '0240000002', body: forged, received_at: 1, via: 'sms' })).toEqual({ kind: 'rejected', error: 'not_a_facility' })
    expect(await referralStatus(cho, referral.id)).toBe('created')
  })
})

describe('QR hop safety', () => {
  it('a carrier holding the signer key still refuses a tampered QR', async () => {
    const cho = await phone('D001')
    const otherCho = await phone('D001')
    const { wire } = await referNewborn(cho)
    expect(await processIncoming(otherCho, { sender: 'qr', body: wire.replace('|3|', '|1|'), received_at: 1, via: 'qr' })).toEqual({ kind: 'rejected', error: 'bad_signature' })
  })

  it('an unverifiable referral is carried only from a QR scan, never accepted by SMS', async () => {
    const cho = await phone('D001')
    const volunteer = await phone('V001')
    await volunteer.db.run('UPDATE devices SET key_hex = NULL')
    const { wire } = await referNewborn(cho)
    expect(await processIncoming(volunteer, { sender: cho.self.phone, body: wire, received_at: 1, via: 'sms' })).toEqual({ kind: 'rejected', error: 'unknown_signer' })
  })
})

describe('outbox', () => {
  it('waits for signal without spending attempts, alternating SIMs, and backs off on real failures', async () => {
    const cho = await phone('D001')
    await referNewborn(cho)
    const [msg] = await dueMessages(cho)
    await markSending(cho, msg!.id, 0)
    await applySendResult(cho, { id: msg!.id, status: 'failed', error: 'no_service', at: cho.now() })
    let row = await cho.db.get<{ status: string; attempts: number; sim_index: number }>('SELECT * FROM outbox')
    expect(row).toMatchObject({ status: 'pending', attempts: 0, sim_index: 1 })
    expect(await dueMessages(cho)).toHaveLength(0)
    cho.tick(60_000)
    expect(await dueMessages(cho)).toHaveLength(1)

    await markSending(cho, msg!.id, 1)
    await applySendResult(cho, { id: msg!.id, status: 'failed', error: 'generic_failure', at: cho.now() })
    row = await cho.db.get('SELECT * FROM outbox')
    expect(row).toMatchObject({ status: 'pending', attempts: 1 })
    cho.tick(29_000)
    expect(await dueMessages(cho)).toHaveLength(0)
    cho.tick(2_000)
    expect(await dueMessages(cho)).toHaveLength(1)
  })

  it('a send with no result after 15 minutes is retried', async () => {
    const cho = await phone('D001')
    await referNewborn(cho)
    const [msg] = await dueMessages(cho)
    await markSending(cho, msg!.id, 0)
    expect(await dueMessages(cho)).toHaveLength(0)
    cho.tick(15 * 60_000)
    expect(await dueMessages(cho)).toHaveLength(1)
  })
})

describe('scheduled pickup', () => {
  it('holds a planned pickup SMS until 18 hours before the appointment', async () => {
    const cho = await phone('D001')
    const { referral } = await referNewborn(cho)
    await radioSends(cho)
    const appointment = cho.now() + 3 * 86_400_000
    await requestTransport(cho, { referral_id: referral.id, provider_id: seed.transport_providers[0]!.id, scheduled_for: appointment })
    expect(await dueMessages(cho)).toHaveLength(0)
    cho.tick(appointment - 18 * 3_600_000 - cho.now())
    const [sms] = await dueMessages(cho)
    expect(sms!.body).toContain('Reply 1 = coming')
  })
})

describe('pickup for a planned follow-up', () => {
  it('needs no referral: the driver gets the house landmark and the CHO compound as destination', async () => {
    const cho = await phone('D001')
    const client = seed.clients.find((c) => c.type === 'pregnant')!
    await requestTransport(cho, { client_id: client.id, provider_id: seed.transport_providers[0]!.id, scheduled_for: cho.now() + 86_400_000 })
    cho.tick(6 * 3_600_000)
    const [sms] = await dueMessages(cho)
    expect(sms!.body).toContain('To Kanshegu CHPS')
    expect(sms!.body).not.toContain('URGENT')
  })
})

describe('transport', () => {
  it('sends the driver a readable SMS and reads a 1 reply as coming', async () => {
    const cho = await phone('D001')
    const { referral } = await referNewborn(cho)
    await radioSends(cho)
    const driver = seed.transport_providers[0]!
    await requestTransport(cho, { referral_id: referral.id, provider_id: driver.id })
    const sms = await radioSends(cho)
    expect(sms.recipient).toBe(driver.phone)
    expect(sms.body).toContain('Reply 1 = coming')
    expect(sms.body).toContain('Savelugu Municipal Hospital')

    expect(await processIncoming(cho, { sender: '+233' + driver.phone.slice(1), body: '1 coming now', received_at: 9, via: 'sms' })).toMatchObject({ kind: 'driver', status: 'coming' })
    expect(await cho.db.get('SELECT status FROM transport_requests')).toEqual({ status: 'coming' })
  })
})
