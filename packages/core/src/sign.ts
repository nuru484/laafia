import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 without padding. */
export function base32(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export const SIG_LENGTH = 8

/**
 * 8 base32 chars = 40 bits of HMAC-SHA256. Enough against guessing over SMS.
 * Shared-key HMAC: a device holding a CHO's key could forge that CHO's
 * messages. Ed25519 over a two-segment SMS would remove that, at twice the SMS cost.
 */
export function sign(deviceKeyHex: string, canonical: string): string {
  return base32(hmac(sha256, hexToBytes(deviceKeyHex), utf8ToBytes(canonical))).slice(0, SIG_LENGTH)
}

export function verify(deviceKeyHex: string, canonical: string, sig: string): boolean {
  const expected = sign(deviceKeyHex, canonical)
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

/** Referral short id from 5 random bytes (caller supplies them: expo-crypto on the phone, node:crypto on the server). */
export function shortIdFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 5) throw new Error('shortIdFromBytes needs 5 bytes')
  return base32(bytes.subarray(0, 5))
}
