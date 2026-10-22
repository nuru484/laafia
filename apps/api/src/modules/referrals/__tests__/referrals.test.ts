import { decode, encode } from '@laafia/core'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ADMIN, KEYS, SID, TODAY, activate, app, event, lfr, prisma, pushAs, sms, useDb } from '../../../platform/testing/helpers.ts'

useDb()

const referralRow = (over: Record<string, unknown> = {}) => ({
  id: 'r-spoof', updated_at: TODAY, origin_device_id: 'D001', short_id: SID, client_code: 'CL-0041', urgency: 3,
  client_type: 'postpartum', danger_signs: ['bleeding'], destination_facility_id: 'fac-0003', ...over,
})
const reasons = (res: { body: { rejected: { reason: string }[] } }) => res.body.rejected.map((r) => r.reason)

describe('referral merge and status', () => {
  it('merges an SMS-first referral with the later phone push onto one row', async () => {
    const res = await sms(encode(lfr, KEYS.D001!))
    expect(res.body).toMatchObject({ ok: true, kind: 'referral', duplicate: false })
    const [fromSms] = await prisma.referral.findMany()
    expect(fromSms).toMatchObject({ originDeviceId: 'D001', shortId: SID, status: 'received', destinationFacilityId: 'fac-0003', dangerSigns: ['bleeding'] })

    // The gateway acknowledged with an LFS signed by the destination facility's phone.
    const [ack] = await prisma.job.findMany()
    const payload = ack!.payload as { to: string; body: string }
    expect(payload.to).toBe('0240000001')
    expect(decode(payload.body, (id) => KEYS[id])).toMatchObject({ ok: true, message: { kind: 'LFS', signer: 'F003', origin: 'D001', short_id: SID, status: 'R' } })

    expect((await sms(encode(lfr, KEYS.D001!))).body).toMatchObject({ ok: true, duplicate: true })
    expect((await sms(encode({ ...lfr, urgency: 1 }, KEYS.D001!))).body).toEqual({ ok: false, error: 'conflict' })

    const jwt = await activate('D001')
    const pushed = await pushAs(jwt, [
      { table: 'referrals', row: { id: 'r-uuid-1', updated_at: TODAY - 5_000, origin_device_id: 'D001', short_id: SID, client_id: 'cl-0041', client_code: 'CL-0041', urgency: 3, danger_signs: ['bleeding'], destination_facility_id: 'fac-0003', status: 'closed' } },
      { table: 'referral_events', row: event({ status: 'sent' }) },
    ])
    expect(pushed.body).toEqual({ accepted: ['r-uuid-1', expect.any(String)], rejected: [] })
    const rows = await prisma.referral.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'r-uuid-1', clientId: 'cl-0041', status: 'received' }) // pushed status ignored
    const events = await prisma.referralEvent.findMany()
    expect(events.map((e) => e.status).sort()).toEqual(['received', 'sent'])
    expect(events.every((e) => e.referralId === 'r-uuid-1')).toBe(true)
  })

  it('never regresses status whatever order events arrive in', async () => {
    const jwt = await activate('D001')
    await pushAs(jwt, [
      { table: 'referral_events', row: event({ status: 'arrived', via: 'sms' }) },
      { table: 'referral_events', row: event({ status: 'sent' }) },
    ])
    const [stub] = await prisma.referral.findMany()
    expect(stub).toMatchObject({ id: 'r-uuid-1', status: 'arrived' })

    const web = await request(app).post('/referrals/r-uuid-1/status').set(ADMIN).send({ status: 'treated' })
    expect(web.body.referral.status).toBe('treated')
    const back = await request(app).post('/referrals/r-uuid-1/status').set(ADMIN).send({ status: 'received' })
    expect(back.body.referral.status).toBe('treated')
    // An LFS for a status behind the current one is also a no-op.
    await sms(encode({ kind: 'LFS', signer: 'F003', origin: 'D001', short_id: SID, status: 'R' }, KEYS.F003!))
    const [after] = await prisma.referral.findMany()
    expect(after!.status).toBe('treated')
  })

  it('lists a facility inbox in the wire format with events', async () => {
    const jwt = await activate('D001')
    await pushAs(jwt, [{ table: 'referrals', row: referralRow() }, { table: 'referral_events', row: event({ referral_id: 'r-spoof', status: 'sent' }) }])
    const res = await request(app).get('/referrals?facility=SAV-HOSP-01').set(ADMIN)
    expect(res.status).toBe(200)
    expect(res.body.referrals[0]).toMatchObject({ id: 'r-spoof', origin_device_id: 'D001', destination_facility_id: 'fac-0003', status: 'sent', events: [expect.objectContaining({ status: 'sent', referral_id: 'r-spoof' })] })
    expect(res.body.referrals[0]).not.toHaveProperty('seq')
  })
})

describe('referral origin and event authority', () => {
  it('refuses a referral or stub created under another device as origin', async () => {
    const volunteer = await activate('V001', '0240000002')
    const spoof = await pushAs(volunteer, [
      { table: 'referrals', row: referralRow() },
      { table: 'referral_events', row: event({ referral_id: 'r-stub', status: 'arrived', source_device_id: 'V001' }) },
    ])
    expect(reasons(spoof)).toEqual(['forbidden', 'unknown_referral'])
    expect(await prisma.referral.findMany()).toHaveLength(0)

    // A carried referral (QR hop) is accepted from another device when it brings the origin's signed LFR.
    const carried = await pushAs(volunteer, [{ table: 'referrals', row: referralRow({ lfr: encode(lfr, KEYS.D001!) }) }])
    expect(carried.body.accepted).toEqual(['r-spoof'])
    const forged = await pushAs(volunteer, [{ table: 'referrals', row: referralRow({ id: 'r-2', short_id: 'AAAAAAAA', lfr: encode({ ...lfr, short_id: 'AAAAAAAA' }, KEYS.V001!) }) }])
    expect(reasons(forged)).toEqual(['forbidden'])
  })

  it('allows events only from the origin, the destination or an onward hop', async () => {
    const cho = await activate('D001')
    await pushAs(cho, [{ table: 'referrals', row: referralRow() }])
    const ev = (by: string, status: string) => ({ table: 'referral_events', row: event({ referral_id: 'r-spoof', status, source_device_id: by }) })

    const unrelated = await activate('F002', '0200000002')
    expect(reasons(await pushAs(unrelated, [ev('F002', 'closed')]))).toEqual(['forbidden'])
    const compound = await activate('F001', '0200000001') // the origin's own facility, but not the destination
    expect(reasons(await pushAs(compound, [ev('F001', 'closed')]))).toEqual(['forbidden'])
    const dest = await activate('F003', '0200000003')
    expect(reasons(await pushAs(dest, [ev('F003', 'arrived')]))).toEqual([])

    // F003 refers onward to F002: F003 stays allowed as a hop, F002 is now the destination.
    expect(reasons(await pushAs(dest, [{ table: 'referrals', row: referralRow({ updated_at: TODAY + 1, destination_facility_id: 'fac-0002' }) }]))).toEqual([])
    expect(reasons(await pushAs(dest, [ev('F003', 'treated')]))).toEqual([])
    expect(reasons(await pushAs(unrelated, [ev('F002', 'treated')]))).toEqual([])
  })
})
