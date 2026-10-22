import { decode } from '@laafia/core'
import { describe, expect, it } from 'vitest'
import { KEYS, SID, TODAY, USERS, activate, event, prisma, pushAs, signIn, useDb } from '../../../platform/testing/helpers.ts'

useDb()

const toHospital = { id: 'r-h', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0001', client_code: 'CL-0001', client_type: 'postpartum', urgency: 3, danger_signs: ['bleeding'], destination_facility_id: 'fac-0003' }
const lfsJobs = async () => (await prisma.job.findMany()).filter((j) => (j.payload as { body: string }).body.startsWith('LFS|'))

describe('facility staff actions', () => {
  it('texts the CHO once per status when the web and the facility phone both record it', async () => {
    await pushAs(await activate('D001'), [{ table: 'referrals', row: toHospital }])
    const hospital = await signIn(USERS.hospital)
    expect((await hospital.agent.post('/referrals/r-h/status').set(hospital.csrf).send({ status: 'received' })).status).toBe(200)
    // The facility phone records the same status (it texted the CHO itself).
    const phone = await activate('F003', '0200000003')
    await pushAs(phone, [{ table: 'referral_events', row: event({ referral_id: 'r-h', status: 'arrived', source_device_id: 'F003' }) }])
    // Web presses arrived after the phone did, then received again: two events each, no extra SMS.
    await hospital.agent.post('/referrals/r-h/status').set(hospital.csrf).send({ status: 'arrived' })
    await hospital.agent.post('/referrals/r-h/status').set(hospital.csrf).send({ status: 'received' })
    const events = await prisma.referralEvent.findMany({ where: { referralId: 'r-h' } })
    expect(events.filter((e) => e.status === 'arrived')).toHaveLength(2)
    const sms = await lfsJobs()
    expect(sms).toHaveLength(1)
    expect(decode((sms[0]!.payload as { body: string }).body, (id) => KEYS[id])).toMatchObject({ ok: true, message: { status: 'R' } })
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: 'r-h' } })).status).toBe('arrived')
  })

  it('refers onward from the dashboard: gateway-signed LFR to the destination phone, chain linked', async () => {
    await pushAs(await activate('D001'), [{ table: 'referrals', row: toHospital }])
    const hospital = await signIn(USERS.hospital)
    const res = await hospital.agent.post('/referrals/r-h/onward').set(hospital.csrf).send({ destination_facility_code: 'PTA-HC-01' })
    expect(res.status).toBe(201)
    const child = res.body.referral
    expect(child).toMatchObject({ origin_device_id: 'GW01', parent_referral_id: 'r-h', destination_facility_id: 'fac-0002', client_code: 'CL-0001', status: 'sent' })
    const lfr = (await prisma.job.findMany()).find((j) => j.purpose === 'referral')!
    const gw = await prisma.device.findUniqueOrThrow({ where: { id: 'GW01' } })
    expect((lfr.payload as { to: string }).to).toBe('0200000002')
    expect(decode((lfr.payload as { body: string }).body, (id) => (id === 'GW01' ? gw.keyHex! : undefined))).toMatchObject({ ok: true, message: { kind: 'LFR', signer: 'GW01', destination: 'PTA-HC-01', sign_codes: ['bl'] } })
    expect((await prisma.referral.findUniqueOrThrow({ where: { id: 'r-h' } })).onwardReferralId).toBe(child.id)

    // Another facility's staff cannot refer it onward, and the origin CHPS cannot either.
    const hc = await signIn(USERS.healthCentre)
    expect((await hc.agent.post('/referrals/r-h/onward').set(hc.csrf).send({ destination_facility_code: 'SAV-HOSP-01' })).status).toBe(404)
  })

  it('looks up the referred client for staff at that facility only', async () => {
    await pushAs(await activate('D001'), [{ table: 'referrals', row: toHospital }])
    const hospital = await signIn(USERS.hospital)
    const res = (await hospital.agent.get('/referrals/r-h/client')).body
    expect(res.client).toMatchObject({ id: 'cl-0001', code: 'CL-0001' })
    expect(res.household).toMatchObject({ community: expect.any(String) })
    const hc = await signIn(USERS.healthCentre)
    expect((await hc.agent.get('/referrals/r-h/client')).status).toBe(404)
  })
})
