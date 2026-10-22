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
 * the sender's phone number: a referral carried by QR and forwarded by a
 * volunteer's SIM still verifies against the CHO who signed it.
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

/** Ghana numbers in any common form to the local 10-digit form, e.g. +233 24 123 4567 -> 0241234567. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('233') && digits.length === 12) return '0' + digits.slice(3)
  if (digits.length === 9) return '0' + digits
  return digits
}

export type TransportRequestText = {
  urgent: boolean
  pickup: string
  destination_name: string
  cho_phone: string
  short_id: string
  lat?: number | null
  lng?: number | null
}

/** Human-readable driver SMS (spec 11.3 LFT). A maps link is added when the house has a GPS fix. */
export function transportRequestText(t: TransportRequestText): string {
  const where = t.lat != null && t.lng != null ? ` maps.google.com/?q=${t.lat.toFixed(5)},${t.lng.toFixed(5)}` : ''
  return (
    `LAAFIA pickup${t.urgent ? ': URGENT' : ''}. ${t.pickup}.${where} To ${t.destination_name}. ` +
    `Call CHO ${t.cho_phone}. Reply 1 = coming, 2 = cannot. Ref ${t.short_id}`
  )
}

/** Driver reply: a leading 1 or 2, anything after it ignored. */
export function parseDriverReply(body: string): 'coming' | 'declined' | null {
  const m = /^\s*([12])\b/.exec(body)
  if (!m) return null
  return m[1] === '1' ? 'coming' : 'declined'
}
