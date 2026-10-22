import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import type { Role } from './relay'

export type Facility = { id: string; code: string; name: string; level: string; phone: string | null; lat: number; lng: number }
export type Session = {
  device_id: string
  device_key: string
  jwt: string
  role: Role
  user_name: string
  phone_number: string
  facility: Facility
  activated_at: number
}

const SESSION = 'laafia_session'
const PIN = 'laafia_pin'
const PIN_STATE = 'laafia_pin_state'
const LEGACY_PIN_ITERATIONS = 100_000
export const LOCK_AFTER = 5
export const WIPE_AFTER = 10
const LOCK_MS = 15 * 60_000

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(SESSION)
  return raw ? (JSON.parse(raw) as Session) : null
}
export async function saveSession(s: Session): Promise<void> {
  await SecureStore.setItemAsync(SESSION, JSON.stringify(s))
}
export async function clearSession(): Promise<void> {
  await Promise.all([SESSION, PIN, PIN_STATE].map((k) => SecureStore.deleteItemAsync(k)))
}

/*
 * The PIN record lives in SecureStore (encrypted by the Android Keystore), and wrong guesses lock at 5 and wipe at 10.
 * A 6-digit PIN has a million values, so a slow KDF cannot stop someone who already reads the record; it only made
 * every unlock take seconds in Hermes. One native salted SHA-256 instead.
 */
type PinRecord = { v?: 2; salt: string; hash: string }
const hash = (pin: string, saltHex: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${saltHex}:${pin}`)
/** Records written before v2: PBKDF2 in JS. Checked once, then rewritten as v2. */
const legacyHash = async (pin: string, saltHex: string) =>
  bytesToHex(await pbkdf2Async(sha256, utf8ToBytes(pin), utf8ToBytes(saltHex), { c: LEGACY_PIN_ITERATIONS, dkLen: 32 }))

async function storePin(pin: string) {
  const salt = bytesToHex(Crypto.getRandomBytes(16))
  const record: PinRecord = { v: 2, salt, hash: await hash(pin, salt) }
  await SecureStore.setItemAsync(PIN, JSON.stringify(record))
}

export async function hasPin(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PIN)) !== null
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN must be 6 digits')
  await storePin(pin)
  await SecureStore.setItemAsync(PIN_STATE, JSON.stringify({ failures: 0, locked_until: 0 }))
}

export type PinCheck = { result: 'ok' } | { result: 'wrong'; remaining: number } | { result: 'locked'; until: number } | { result: 'wipe' }

/** Five wrong PINs lock for 15 minutes; ten wipe the phone's copy of the data (spec 18.2). */
export async function checkPin(pin: string, now = Date.now()): Promise<PinCheck> {
  const stored = await SecureStore.getItemAsync(PIN)
  if (!stored) return { result: 'wipe' }
  const state = JSON.parse((await SecureStore.getItemAsync(PIN_STATE)) ?? '{"failures":0,"locked_until":0}') as { failures: number; locked_until: number }
  if (state.locked_until > now) return { result: 'locked', until: state.locked_until }
  const record = JSON.parse(stored) as PinRecord
  if ((await (record.v === 2 ? hash : legacyHash)(pin, record.salt)) === record.hash) {
    if (record.v !== 2) await storePin(pin)
    await SecureStore.setItemAsync(PIN_STATE, JSON.stringify({ failures: 0, locked_until: 0 }))
    return { result: 'ok' }
  }
  const failures = state.failures + 1
  if (failures >= WIPE_AFTER) return { result: 'wipe' }
  const locked_until = failures % LOCK_AFTER === 0 ? now + LOCK_MS : 0
  await SecureStore.setItemAsync(PIN_STATE, JSON.stringify({ failures, locked_until }))
  return locked_until ? { result: 'locked', until: locked_until } : { result: 'wrong', remaining: WIPE_AFTER - failures }
}
