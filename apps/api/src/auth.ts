import { normalizePhone } from '@laafia/core'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { RequestHandler, Response } from 'express'
import { jwtVerify, SignJWT } from 'jose'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { db, write } from './db.ts'
import { HttpError } from './http.ts'
import { activation_codes, devices, facilities } from './schema.ts'

const rawSecret = process.env.JWT_SECRET
if (!rawSecret && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production')
const secret = new TextEncoder().encode(rawSecret ?? 'dev-only-secret-not-for-production')

export type Device = typeof devices.$inferSelect
export type Actor = { kind: 'device'; device: Device } | { kind: 'admin' }

// Phones are offline for weeks, so tokens are long-lived; refresh accepts a token up to 60 days past expiry. Deactivation is the revocation path.
const TOKEN_TTL = '30d'
const REFRESH_GRACE_S = 60 * 86_400

export const issueToken = (d: Device) =>
  new SignJWT({ role: d.role }).setProtectedHeader({ alg: 'HS256' }).setSubject(d.id).setIssuedAt().setExpirationTime(TOKEN_TTL).sign(secret)

async function deviceFromToken(token: string, clockTolerance = 0): Promise<Device> {
  let sub: string | undefined
  try {
    sub = (await jwtVerify(token, secret, { algorithms: ['HS256'], clockTolerance })).payload.sub
  } catch {
    throw new HttpError(401, 'invalid_token', 'Token is invalid or expired')
  }
  const [device] = sub ? await db.select().from(devices).where(eq(devices.id, sub)) : []
  if (!device) throw new HttpError(401, 'invalid_token', 'Unknown device')
  if (!device.active) throw new HttpError(401, 'deactivated', 'This device has been deactivated')
  return device
}

const isAdminToken = (token: string) => {
  const admin = process.env.ADMIN_TOKEN
  if (!admin) return false
  const a = Buffer.from(token)
  const b = Buffer.from(admin)
  return a.length === b.length && timingSafeEqual(a, b)
}

function tokenOf(req: Parameters<RequestHandler>[0]): string | undefined {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7)
  const admin = req.headers['x-admin-token']
  if (typeof admin === 'string') return admin
  return typeof req.query.token === 'string' ? req.query.token : undefined
}

/** Bearer device JWT (or ?token= for EventSource). `admin: true` also admits the ADMIN_TOKEN (header x-admin-token, or ?token=). */
export function auth(opts: { roles?: Device['role'][]; admin?: boolean } = {}): RequestHandler {
  return async (req, res, next) => {
    const token = tokenOf(req)
    if (!token) throw new HttpError(401, 'unauthenticated', 'Missing token')
    if (isAdminToken(token)) {
      if (!opts.admin) throw new HttpError(403, 'forbidden', 'Admin token not accepted here')
      res.locals.actor = { kind: 'admin' } satisfies Actor
      return next()
    }
    const device = await deviceFromToken(token)
    if (opts.roles && !opts.roles.includes(device.role)) throw new HttpError(403, 'forbidden', `Role ${device.role} may not call this`)
    res.locals.actor = { kind: 'device', device } satisfies Actor
    next()
  }
}

export const actorOf = (res: Response) => res.locals.actor as Actor
export const deviceOf = (res: Response) => {
  const a = actorOf(res)
  if (a.kind !== 'device') throw new HttpError(403, 'forbidden', 'Device token required')
  return a.device
}

/** Keys a device needs to verify SMS: facility phones get every active device's key (demo: no district scoping), others none. */
export async function keysFor(d: Device): Promise<Record<string, string> | undefined> {
  if (d.role !== 'facility') return undefined
  const rows = await db.select({ id: devices.id, key: devices.key_hex }).from(devices).where(and(eq(devices.active, true), isNotNull(devices.key_hex)))
  return Object.fromEntries(rows.map((r) => [r.id, r.key!]))
}

async function profile(d: Device) {
  const [facility] = d.facility_id ? await db.select().from(facilities).where(eq(facilities.id, d.facility_id)) : []
  const { seq: _seq, ...fac } = facility ?? { seq: 0 }
  return { device_id: d.id, role: d.role, user_name: d.user_name, phone_number: d.phone_number, facility: facility ? fac : null }
}

export const ActivateBody = z.object({
  activation_code: z.string().regex(/^\d{8}$/),
  phone_number: z.string().min(9).max(20),
  device_info: z.record(z.string(), z.unknown()).optional(),
})

export async function activate(body: z.infer<typeof ActivateBody>) {
  const now = Date.now()
  const device = await write(async (tx) => {
    const [code] = await tx.select().from(activation_codes).where(eq(activation_codes.code, body.activation_code)).for('update')
    if (!code || code.used_at !== null || code.expires_at < now) throw new HttpError(400, 'invalid_code', 'Activation code is invalid, used or expired')
    const [d] = await tx.select().from(devices).where(eq(devices.id, code.device_id))
    if (!d?.active) throw new HttpError(401, 'deactivated', 'This device has been deactivated')
    await tx.update(activation_codes).set({ used_at: now }).where(eq(activation_codes.code, code.code))
    // Seeded demo devices keep their deterministic key so phones and server agree offline.
    const [updated] = await tx.update(devices)
      .set({ key_hex: d.key_hex ?? randomBytes(32).toString('hex'), phone_number: normalizePhone(body.phone_number), activated_at: now, updated_at: now })
      .where(eq(devices.id, d.id)).returning()
    return updated!
  })
  return { device_id: device.id, device_key: device.key_hex!, jwt: await issueToken(device), profile: await profile(device), keys: await keysFor(device) }
}

export async function refresh(token: string) {
  const device = await deviceFromToken(token, REFRESH_GRACE_S)
  return { jwt: await issueToken(device) }
}
