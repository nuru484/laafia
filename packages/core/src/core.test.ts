import { describe, expect, it } from 'vitest'
import {
  ACK_TIMEOUT_MS,
  FOLLOWUP_FLOOR,
  PROTOCOLS,
  RISK_MODEL,
  SMS_SEGMENT,
  decode,
  deriveStatus,
  encode,
  evaluate,
  next,
  normalizePhone,
  parse,
  parseDriverReply,
  planRoute,
  rank,
  referralAlert,
  resolveDestination,
  shortIdFromBytes,
  signCodes,
  signNames,
  transportRequestText,
  type Client,
  type Facility,
  type ReferralMessage,
  type Visit,
} from './index.ts'

const KEY = '11'.repeat(32)
const OTHER_KEY = '22'.repeat(32)
const DAY = 86_400_000
const TODAY = Date.UTC(2026, 9, 22)

const referral: ReferralMessage = {
  kind: 'LFR',
  signer: 'D017',
  short_id: shortIdFromBytes(new Uint8Array([1, 2, 3, 4, 5])),
  client_code: 'CL-0417',
  urgency: 3,
  client_type: 'NB',
  context: 'PP3',
  sign_codes: ['nf', 'cv'],
  destination: 'TAM-CHPS-04',
  next_of_kin: '0241234567',
}

describe('codec', () => {
  it('round-trips a signed referral inside one SMS segment', () => {
    const sms = encode(referral, KEY)
    expect(sms.length).toBeLessThanOrEqual(SMS_SEGMENT)
    expect(decode(sms, () => KEY)).toEqual({ ok: true, message: referral })
  })

  it('carries device-scoped client codes made on phones', () => {
    const sms = encode({ ...referral, client_code: 'CL-D001003' }, KEY)
    expect(decode(sms, () => KEY)).toMatchObject({ ok: true, message: { client_code: 'CL-D001003' } })
  })

  it('fits the worst realistic referral in one segment', () => {
    const worst = { ...referral, signer: 'DEV12345', client_code: 'CL-DEV12345999', context: 'AGE59M', sign_codes: ['nd', 'cv', 'vo', 'lt', 'ci', 'oe', 'mr', 'bs', 'pd', 'pf'], destination: 'TAMALE-HOSP-01' }
    expect(encode(worst, KEY).length).toBeLessThanOrEqual(SMS_SEGMENT)
  })

  it('rejects a tampered body, a wrong key and an unknown signer', () => {
    const sms = encode(referral, KEY)
    expect(decode(sms.replace('|3|', '|1|'), () => KEY)).toEqual({ ok: false, error: 'bad_signature' })
    expect(decode(sms, () => OTHER_KEY)).toEqual({ ok: false, error: 'bad_signature' })
    expect(decode(sms, () => undefined)).toEqual({ ok: false, error: 'unknown_signer' })
  })

  it('verifies by the signer field, not the sender, so a QR-carried copy forwarded from another SIM still verifies', () => {
    const keys: Record<string, string> = { D017: KEY, V002: OTHER_KEY }
    expect(decode(encode(referral, KEY), (id) => keys[id]).ok).toBe(true)
  })

  it('ignores ordinary SMS and malformed Laafia-looking text', () => {
    expect(parse('Hello, are you coming?')).toBeNull()
    expect(parse('LFR|1|D017|bad')).toBeNull()
    expect(parse('LFR|9|D017|AEBAGBAF|CL-0417|3|NB|PP3|nf|TAM-CHPS-04|-|AAAAAAAA')).toBeNull()
  })

  it('refuses to encode fields that would break the wire', () => {
    expect(() => encode({ ...referral, destination: 'TAM|X' }, KEY)).toThrow()
    expect(() => encode({ ...referral, sign_codes: ['n,f'] }, KEY)).toThrow()
  })

  it('round-trips a status message', () => {
    const sms = encode({ kind: 'LFS', signer: 'F004', origin: 'D017', short_id: referral.short_id, status: 'A' }, OTHER_KEY)
    const d = decode(sms, () => OTHER_KEY)
    expect(d.ok && d.message.kind === 'LFS' && d.message.status).toBe('A')
  })

  it('normalizes Ghana numbers and parses driver replies', () => {
    expect(normalizePhone('+233 24 123 4567')).toBe('0241234567')
    expect(normalizePhone('0241234567')).toBe('0241234567')
    expect(parseDriverReply(' 1 ok I am coming')).toBe('coming')
    expect(parseDriverReply('2')).toBe('declined')
    expect(parseDriverReply('12')).toBeNull()
    expect(parseDriverReply('yes')).toBeNull()
  })

  it('writes a driver SMS with a maps link when the house has GPS', () => {
    const text = transportRequestText({ urgent: true, pickup: 'Mba Alhassan house, behind mosque, Zoggu', destination_name: 'Savelugu Hospital', cho_phone: '0241234567', short_id: referral.short_id, lat: 9.62, lng: -0.82 })
    expect(text).toContain('maps.google.com/?q=9.62000,-0.82000')
    expect(text).toContain('Reply 1 = coming, 2 = cannot')
  })
})

describe('rules', () => {
  const yi = PROTOCOLS.young_infant
  const child = PROTOCOLS.child
  const maternal = PROTOCOLS.maternal

  it('every rule refers only to declared signs and actions', () => {
    for (const p of Object.values(PROTOCOLS)) {
      for (const r of p.rules) {
        if (r.danger_sign) expect(p.signs[r.danger_sign], `${p.id} ${r.id}`).toBeDefined()
        for (const a of r.actions) expect(p.actions[a], `${p.id} ${r.id} ${a}`).toBeDefined()
      }
      const codes = Object.values(p.signs).map((s) => s.code)
      expect(new Set(codes).size).toBe(codes.length)
    }
  })

  it.each([
    [{ yi_feeding: false }, 'refer', 'YI-R1', 3],
    [{ yi_feeding: true, yi_convulsions: true }, 'refer', 'YI-R2', 3],
    [{ yi_breaths: 64 }, 'refer', 'YI-R4', 2],
    [{ yi_breaths: 59 }, 'routine', 'YI-DEFAULT', 0],
    [{ yi_temp: 37.5 }, 'refer', 'YI-R6', 3],
    [{ yi_temp: 35.4 }, 'refer', 'YI-R7', 3],
    [{ yi_temp: 36.0 }, 'followup', 'YI-F1', 0],
    [{ yi_temp: 36.8 }, 'routine', 'YI-DEFAULT', 0],
    [{ yi_cord: true }, 'followup', 'YI-F2', 0],
    [{ birth_weight_g: 2200, age_days: 3 }, 'followup', 'YI-F3', 0],
    [{ birth_weight_g: 2200, age_days: 20 }, 'routine', 'YI-DEFAULT', 0],
    [{ yi_jaundice: true }, 'refer', 'YI-R8', 2],
  ])('young infant %j -> %s by %s', (answers, outcome, rule, urgency) => {
    const e = evaluate(yi, answers)
    expect([e.outcome, e.rule_id, e.urgency]).toEqual([outcome, rule, urgency])
  })

  it('collects every danger sign and picks the highest destination', () => {
    const e = evaluate(yi, { yi_breaths: 70, yi_convulsions: true })
    expect(e.rule_id).toBe('YI-R2')
    expect(e.danger_signs).toEqual(['convulsions', 'fast_breathing'])
    expect(e.destination_query).toBe('nearest:hospital')
    expect(signNames(yi, signCodes(yi, e.danger_signs))).toEqual(e.danger_signs)
  })

  it('refer beats follow-up', () => {
    expect(evaluate(yi, { yi_cord: true, yi_jaundice: true }).outcome).toBe('refer')
  })

  it.each([
    [{ ch_breaths: 52, age_months: 8 }, 'followup', 'CH-F1'],
    [{ ch_breaths: 45, age_months: 8 }, 'routine', 'CH-DEFAULT'],
    [{ ch_breaths: 45, age_months: 30 }, 'followup', 'CH-F2'],
    [{ ch_muac: 110 }, 'refer', 'CH-R7'],
    [{ ch_muac: 120 }, 'followup', 'CH-F5'],
    [{ ch_muac: 130 }, 'routine', 'CH-DEFAULT'],
    [{ ch_fever: true, ch_fever_days: 8 }, 'refer', 'CH-R10'],
    [{ ch_drink: false }, 'refer', 'CH-R1'],
  ])('child %j -> %s by %s', (answers, outcome, rule) => {
    const e = evaluate(child, answers)
    expect([e.outcome, e.rule_id]).toEqual([outcome, rule])
  })

  it('maternal bleeding goes to a CEmONC facility', () => {
    const e = evaluate(maternal, { client_type: 'postpartum', m_bleeding: true })
    expect([e.outcome, e.urgency, e.destination_query]).toEqual(['refer', 3, 'nearest:capability:cemonc'])
  })

  it('skips questions that do not apply', () => {
    let answers: Record<string, unknown> = { client_type: 'postpartum' }
    const asked: string[] = []
    for (let q = next(maternal, answers); q; q = next(maternal, answers)) {
      asked.push(q.id)
      answers = { ...answers, [q.id]: false }
    }
    expect(asked).not.toContain('m_fetal_movement')
    expect(asked).toContain('m_discharge')
    expect(next(child, { age_months: 4, ch_cough: false })?.id).toBe('ch_drink')
  })

  it('an unanswered question never fires a rule', () => {
    expect(evaluate(yi, {}).outcome).toBe('routine')
  })
})

const client = (over: Partial<Client>): Client => ({
  id: 'c', household_id: 'h', code: 'CL-0001', type: 'child', name: 'x', sex: 'f', dob: null, edd: null,
  delivery_date: null, parity: null, prior_complications: [], birth_weight_g: null, nhis_active: true, ...over,
})

describe('scorer', () => {
  const visit = (over: Partial<Visit>): Visit => ({
    id: 'v', client_id: 'c', protocol_id: 'child', visited_at: TODAY - 10 * DAY, answers: {}, outcome: 'routine',
    rule_id: 'X', followup_due: null, muac_mm: null, ...over,
  })

  it('ranks a 3-day postpartum mother with no PNC above a well child, with the reason', () => {
    const mother = client({ id: 'm', type: 'postpartum', delivery_date: TODAY - 3 * DAY })
    const well = client({ id: 'w', dob: TODAY - 400 * DAY })
    const [first, second] = rank(RISK_MODEL, [well, mother], [], new Set(), TODAY)
    expect(first!.client_id).toBe('m')
    expect(first!.reasons.map((r) => r.text)).toEqual(['3 days after delivery', 'no postnatal visit recorded'])
    expect(second!.score).toBeLessThan(first!.score)
  })

  it('pins open referrals, then newborns inside 48 h without PNC', () => {
    const nb = client({ id: 'nb', type: 'newborn', dob: TODAY - DAY })
    const ref = client({ id: 'ref', dob: TODAY - 900 * DAY })
    const sick = client({ id: 'sick', type: 'postpartum', delivery_date: TODAY - 2 * DAY, prior_complications: ['pph'] })
    const out = rank(RISK_MODEL, [sick, nb, ref], [], new Set(['ref']), TODAY)
    expect(out.map((r) => [r.client_id, r.pinned])).toEqual([['ref', 'open_referral'], ['nb', 'newborn_48h'], ['sick', null]])
  })

  it('lifts a due follow-up above the routine list, keeps their own order, and explains MUAC', () => {
    const red = client({ id: 'red', dob: TODAY - 700 * DAY })
    const yellow = client({ id: 'yellow', dob: TODAY - 700 * DAY })
    const well = client({ id: 'well', dob: TODAY - 700 * DAY, birth_weight_g: 2100 })
    const visits = [visit({ client_id: 'red', muac_mm: 112, followup_due: TODAY - 3 * DAY }), visit({ id: 'v2', client_id: 'yellow', muac_mm: 120, followup_due: TODAY - 3 * DAY })]
    const out = rank(RISK_MODEL, [well, yellow, red], visits, new Set(), TODAY)
    expect(out.map((x) => x.client_id)).toEqual(['red', 'yellow', 'well'])
    const r = out[0]
    expect(r!.score).toBeGreaterThanOrEqual(FOLLOWUP_FLOOR)
    expect(r!.reasons.map((x) => x.text)).toContain('MUAC red')
    expect(r!.reasons.map((x) => x.text)).toContain('follow-up due 3 days ago')
  })

  it('more overdue ANC never lowers the score', () => {
    const at = (gaWeeks: number) => rank(RISK_MODEL, [client({ type: 'pregnant', edd: TODAY + (280 - gaWeeks * 7) * DAY, parity: 2 })], [], new Set(), TODAY)[0]!.score
    expect(at(14)).toBeLessThanOrEqual(at(16))
    expect(at(16)).toBeLessThanOrEqual(at(20))
  })
})

describe('geo', () => {
  const origin = { lat: 9.4, lng: -0.85 }
  it('finishes a community before moving on; stops without GPS go last', () => {
    const stops = [
      { id: 'b1', community: 'B', lat: 9.45, lng: -0.85 },
      { id: 'a1', community: 'A', lat: 9.401, lng: -0.85 },
      { id: 'nogps', community: 'A', lat: null, lng: null },
      { id: 'a2', community: 'A', lat: 9.5, lng: -0.85 },
    ]
    expect(planRoute(stops, origin)).toEqual(['a1', 'a2', 'b1', 'nogps'])
  })

  const f = (code: string, level: Facility['level'], lat: number, capabilities: string[] = []): Facility => ({ id: code, code, name: code, level, phone: null, lat, lng: -0.85, capabilities })
  const facilities = [f('CHPS', 'chps', 9.41), f('HC', 'health_centre', 9.45), f('HOSP', 'hospital', 9.6, ['cemonc']), f('FAR', 'hospital', 9.9, ['cemonc'])]

  it('resolves level and capability queries to the nearest match, with a hospital fallback', () => {
    expect(resolveDestination('nearest:health_centre', facilities, origin)?.code).toBe('HC')
    expect(resolveDestination('nearest:capability:cemonc', facilities, origin)?.code).toBe('HOSP')
    expect(resolveDestination('nearest:capability:theatre', facilities, origin)?.code).toBe('HOSP')
  })
})

describe('status', () => {
  it('only moves forward whatever order events arrive in', () => {
    expect(deriveStatus([{ status: 'arrived' }, { status: 'received' }, { status: 'sent' }])).toBe('arrived')
    expect(deriveStatus([])).toBe('created')
    expect(deriveStatus([{ status: 'sent' }, { status: 'cancelled' }])).toBe('cancelled')
  })

  it('raises no_ack after the urgency timeout and not_arrived after the window', () => {
    const sent = [{ status: 'sent' as const, at: 0 }]
    expect(referralAlert(sent, 3, ACK_TIMEOUT_MS[3] - 1)).toBeNull()
    expect(referralAlert(sent, 3, ACK_TIMEOUT_MS[3])).toBe('no_ack')
    expect(referralAlert([...sent, { status: 'received', at: 0 }], 3, 7 * 3_600_000)).toBe('not_arrived')
    expect(referralAlert([...sent, { status: 'arrived', at: 0 }], 3, 99 * 3_600_000)).toBeNull()
  })
})

describe('seed', () => {
  it('is deterministic, sized like a catchment, and puts the demo newborn near the top', async () => {
    const { generateSeed } = await import('./seed.ts')
    const a = generateSeed(TODAY)
    expect(generateSeed(TODAY)).toEqual(a)
    expect(a.households).toHaveLength(40)
    expect(a.clients.length).toBeGreaterThanOrEqual(50)
    expect(new Set(a.clients.map((c) => c.code)).size).toBe(a.clients.length)
    const top = rank(RISK_MODEL, a.clients, a.visits, new Set(), TODAY).slice(0, 5).map((r) => a.clients.find((c) => c.id === r.client_id)!.name)
    expect(top.some((n) => n.startsWith('Baby of Amina'))).toBe(true)
  })
})
