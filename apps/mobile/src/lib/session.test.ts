import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { createHash, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}))
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)),
  digestStringAsync: async (_alg: string, data: string) => createHash('sha256').update(data).digest('hex'),
}))

const { checkPin, setPin } = await import('./session')

beforeEach(() => store.clear())

describe('PIN', () => {
  it('unlocks with the right PIN and counts a wrong one', async () => {
    await setPin('482915')
    expect(await checkPin('482915')).toEqual({ result: 'ok' })
    expect(await checkPin('000000')).toEqual({ result: 'wrong', remaining: 9 })
    expect(JSON.parse(store.get('laafia_pin')!)).toMatchObject({ v: 2 })
  })

  it('accepts a PIN set before the switch to native hashing, then stores it the new way', async () => {
    const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const legacy = bytesToHex(pbkdf2(sha256, utf8ToBytes('482915'), utf8ToBytes(salt), { c: 100_000, dkLen: 32 }))
    store.set('laafia_pin', JSON.stringify({ salt, hash: legacy }))
    expect(await checkPin('000000')).toEqual({ result: 'wrong', remaining: 9 })
    expect(await checkPin('482915')).toEqual({ result: 'ok' })
    expect(JSON.parse(store.get('laafia_pin')!)).toMatchObject({ v: 2 })
    expect(await checkPin('482915')).toEqual({ result: 'ok' })
  }, 20_000) // three 100k-round PBKDF2 runs in plain JS
})
