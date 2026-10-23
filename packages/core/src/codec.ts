import { sign, verify } from './sign.ts'
import type { ClientWireType } from './types.ts'

/*
 * SMS wire formats (spec 11.3), pipe-delimited ASCII, one GSM-7 segment.
 *
 *   LFR|1|<signer>|<sid>|<client>|<urg>|<type>|<ctx>|<signs>|<dest>|<nok>|<sig>
 *   LFS|1|<signer>|<origin>|<sid>|<status>|<sig>
 *
 * A referral is identified by (origin device, short id), so short ids never
 * collide across devices. The signer field names the key to verify with, not
 * the sender's phone number: an onward referral or a resend from another SIM
 * still verifies against the device that signed it.
 */

export const WIRE_VERSION = '1'
export const SMS_SEGMENT = 160

export type ReferralMessage = {
  kind: 'LFR'
  signer: string
  short_id: string
  client_code: string
  urgency: 1 | 2 | 3
  client_type: ClientWireType
  context: string
  sign_codes: string[]
  destination: string
  next_of_kin: string | null
}

export type StatusCode = 'R' | 'A' | 'T' | 'C'

export type StatusMessage = {
  kind: 'LFS'
  signer: string
  origin: string
  short_id: string
  status: StatusCode
}

export type WireMessage = ReferralMessage | StatusMessage

const DEVICE = /^[A-Z0-9]{2,8}$/
const SHORT_ID = /^[A-Z2-7]{8}$/
const CLIENT = /^[A-Z]{2}-[A-Z0-9]{1,12}$/
const CONTEXT = /^([A-Z]{2,3}\d{1,3}M?|-)$/
const SIGNS = /^([a-z]{2}(,[a-z]{2})*|-)$/
const FACILITY = /^[A-Z0-9-]{3,16}$/
const PHONE = /^(0\d{9}|-)$/
const SIG = /^[A-Z2-7]{8}$/
const TYPES = ['PW', 'PP', 'NB', 'CH'] as const
const STATUSES = ['R', 'A', 'T', 'C'] as const

function check(field: string, value: string, re: RegExp) {
  if (!re.test(value)) throw new Error(`invalid ${field}: ${value}`)
}

function fields(m: WireMessage): string[] {
  if (m.kind === 'LFR') {
    return [
      'LFR', WIRE_VERSION, m.signer, m.short_id, m.client_code, String(m.urgency), m.client_type,
      m.context || '-', m.sign_codes.length ? m.sign_codes.join(',') : '-', m.destination, m.next_of_kin ?? '-',
    ]
  }
  return ['LFS', WIRE_VERSION, m.signer, m.origin, m.short_id, m.status]
}

function validate(m: WireMessage) {
  check('signer', m.signer, DEVICE)
  check('short_id', m.short_id, SHORT_ID)
  if (m.kind === 'LFR') {
    check('client_code', m.client_code, CLIENT)
    if (![1, 2, 3].includes(m.urgency)) throw new Error(`invalid urgency: ${m.urgency}`)
    if (!TYPES.includes(m.client_type)) throw new Error(`invalid client_type: ${m.client_type}`)
    check('context', m.context || '-', CONTEXT)
    check('sign_codes', m.sign_codes.length ? m.sign_codes.join(',') : '-', SIGNS)
    check('destination', m.destination, FACILITY)
    check('next_of_kin', m.next_of_kin ?? '-', PHONE)
  } else {
    check('origin', m.origin, DEVICE)
    if (!STATUSES.includes(m.status)) throw new Error(`invalid status: ${m.status}`)
  }
}

/** Encode and sign. Throws on any field that would not survive the wire. */
export function encode(m: WireMessage, deviceKeyHex: string): string {
  validate(m)
  const canonical = fields(m).join('|') + '|'
  return canonical + sign(deviceKeyHex, canonical)
}

export type Parsed = { message: WireMessage; canonical: string; sig: string }

/** Parse without verifying. Returns null for anything that is not a Laafia message (ordinary SMS). */
export function parse(body: string): Parsed | null {
  const text = body.trim()
  if (!text.startsWith('LFR|') && !text.startsWith('LFS|')) return null
  const parts = text.split('|')
  const sig = parts[parts.length - 1] ?? ''
  if (!SIG.test(sig) || parts[1] !== WIRE_VERSION) return null
  const canonical = text.slice(0, text.length - sig.length)
  const p = (i: number) => parts[i] ?? ''
  let message: WireMessage
  if (parts[0] === 'LFR' && parts.length === 12) {
    message = {
      kind: 'LFR',
      signer: p(2),
      short_id: p(3),
      client_code: p(4),
      urgency: Number(p(5)) as 1 | 2 | 3,
      client_type: p(6) as ClientWireType,
      context: p(7),
      sign_codes: p(8) === '-' ? [] : p(8).split(','),
      destination: p(9),
      next_of_kin: p(10) === '-' ? null : p(10),
    }
  } else if (parts[0] === 'LFS' && parts.length === 7) {
    message = { kind: 'LFS', signer: p(2), origin: p(3), short_id: p(4), status: p(5) as StatusCode }
  } else {
    return null
  }
  try {
    validate(message)
  } catch {
    return null
  }
  return { message, canonical, sig }
}

export type Decoded = { ok: true; message: WireMessage } | { ok: false; error: 'not_laafia' | 'unknown_signer' | 'bad_signature' }

/** Parse and verify. `keyFor` returns the signer device's key hex, or undefined if the device is unknown or deactivated. */
export function decode(body: string, keyFor: (deviceId: string) => string | undefined): Decoded {
  const parsed = parse(body)
  if (!parsed) return { ok: false, error: 'not_laafia' }
  const key = keyFor(parsed.message.signer)
  if (!key) return { ok: false, error: 'unknown_signer' }
  if (!verify(key, parsed.canonical, parsed.sig)) return { ok: false, error: 'bad_signature' }
  return { ok: true, message: parsed.message }
}

/*
 * Slip code: the referral SMS rewritten so a CHO can copy it onto the paper slip the client carries. A facility
 * the SMS never reached types it in and gets back the exact signed text, so receiving, verifying and syncing are
 * the SMS path unchanged. Eight groups:
 *
 *   <signer> <sid> <client without dash> <urgency><type> <ctx|0> <signs|0> <nok|0> <sig>
 *
 * The destination is left out to keep it short: the facility tries the codes it knows against the signature.
 */
export function slipCode(sms: string): string {
  const p = parse(sms)
  if (p?.message.kind !== 'LFR') throw new Error('not a referral SMS')
  const m = p.message
  return [m.signer, m.short_id, m.client_code.replace('-', ''), `${m.urgency}${m.client_type}`, m.context === '-' ? '0' : m.context,
    m.sign_codes.join('').toUpperCase() || '0', m.next_of_kin ?? '0', p.sig].join(' ')
}

const KIND = /^[123](PW|PP|NB|CH)$/
const CLIENT_RUN = /^[A-Z]{2}[A-Z0-9]{1,12}$/
const CONTEXT_RUN = /^(0|[A-Z]{2,3}\d{1,3}M?)$/
const SIGNS_RUN = /^(0|([A-Z]{2})+)$/

/**
 * The eight groups a slip code could be. Typed with spaces or dashes, they are those groups. Typed as one run of
 * letters and digits, every split that the phone's known signers and the shape of each group allow; the signature
 * then picks the right one, so a wrong split never reads as a referral.
 */
function slipReadings(code: string, signers: string[]): string[][] {
  const g = code.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  if (g.length === 8) return [g]
  const run = g.join('')
  const out: string[][] = []
  for (const signer of signers.map((x) => x.toUpperCase())) {
    if (!run.startsWith(signer)) continue
    const body = run.slice(signer.length)
    if (body.length < 8 + 3 + 3 + 3 + 8) continue
    const [sid, sig, rest] = [body.slice(0, 8), body.slice(-8), body.slice(8, -8)]
    for (let k = 3; k + 3 <= rest.length; k++) {
      const client = rest.slice(0, k)
      const kind = rest.slice(k, k + 3)
      if (!KIND.test(kind) || !CLIENT_RUN.test(client)) continue
      const tail = rest.slice(k + 3)
      const noks = [...(tail.endsWith('0') ? ['0'] : []), ...(/\d{10}$/.test(tail) ? [tail.slice(-10)] : [])]
      for (const nok of noks) {
        const mid = tail.slice(0, tail.length - nok.length)
        for (let c = 1; c < mid.length; c++) {
          const [ctx, signs] = [mid.slice(0, c), mid.slice(c)]
          if (CONTEXT_RUN.test(ctx) && SIGNS_RUN.test(signs)) out.push([signer, sid, client, kind, ctx, signs, nok, sig])
        }
      }
    }
  }
  return out
}

/**
 * The signed referral SMS a slip code stands for, or null when no reading makes the signature check out (a typo).
 * `signers` are the device ids this phone holds keys for; they let a code typed without spaces be read.
 */
export function fromSlip(code: string, destinations: string[], keyFor: (deviceId: string) => string | undefined, signers: string[] = []): string | null {
  // The random groups are base32 without the digits 0, 1 and 8, so those are hand-copied O, I and B.
  const b32 = (s: string) => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B')
  for (const [signer, sid, client, kind, ctx, signs, nok, sig] of slipReadings(code, signers) as [string, string, string, string, string, string, string, string][]) {
    const head = ['LFR', WIRE_VERSION, signer, b32(sid), `${client.slice(0, 2)}-${client.slice(2)}`, kind.slice(0, 1), kind.slice(1),
      ctx === '0' ? '-' : ctx, signs === '0' ? '-' : (signs.toLowerCase().match(/../g) ?? []).join(',')]
    for (const destination of destinations) {
      const sms = [...head, destination, nok === '0' ? '-' : nok, b32(sig)].join('|')
      if (decode(sms, keyFor).ok) return sms
    }
  }
  return null
}

/** Ghana numbers in any common form to the local 10-digit form, e.g. +233 24 123 4567 -> 0241234567. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3)
  if (digits.length === 9) return '0' + digits
  return digits
}
