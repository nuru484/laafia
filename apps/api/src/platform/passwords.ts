import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'

/*
 * argon2id with Node's built-in implementation (no native addon). Parameters are the
 * OWASP minimum (19 MiB, 2 passes, 1 lane). Stored as a PHC string so parameters can
 * change later without breaking existing hashes.
 */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 }

const derive = (password: string, nonce: Buffer, p: typeof PARAMS) =>
  new Promise<Buffer>((ok, fail) => argon2('argon2id', { message: password, nonce, ...p }, (e, key) => (e ? fail(e) : ok(key))))

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, PARAMS)
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored)
  if (!m) return false
  const expected = Buffer.from(m[5]!, 'base64url')
  const got = await derive(password, Buffer.from(m[4]!, 'base64url'), { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]), tagLength: expected.length })
  return got.length === expected.length && timingSafeEqual(got, expected)
}
