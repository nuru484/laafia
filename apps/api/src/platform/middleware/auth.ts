import type { Device as DeviceRow } from '@prisma/client'
import type { RequestHandler, Response } from 'express'
import { jwtVerify, SignJWT } from 'jose'
import { timingSafeEqual } from 'node:crypto'
import type { Deps } from '../deps.ts'
import { HttpError } from '../http/errors.ts'
import { readCookie, resolveSession, SESSION_COOKIE, sha256 } from '../sessions.ts'

/** A device row with epoch fields as numbers (see platform/db.ts). */
export type Device = Omit<DeviceRow, 'updatedAt' | 'seq' | 'activatedAt'> & { updatedAt: number; seq: number; activatedAt: number | null }
export type Role = 'cho' | 'facility' | 'gateway'
/** Every phone role, for routes any activated phone may call. The gateway is not a phone and never signs in. */
export const PHONES: Role[] = ['cho', 'facility']
export type UserRole = 'district_admin' | 'facility_staff' | 'supervisor'
export type WebUser = { id: string; name: string; role: UserRole; facilityId: string | null; districtId: string | null }
/**
 * device: a phone (Bearer JWT). user: a dashboard account (session cookie), scoped by role.
 * admin: the ADMIN_TOKEN, for scripts only; unscoped.
 */
export type Actor = { kind: 'device'; device: Device } | { kind: 'user'; user: WebUser } | { kind: 'admin' }

// Phones are offline for weeks, so tokens are long-lived; refresh accepts a token up to 60 days past expiry. Deactivation is the revocation path.
const TOKEN_TTL = '30d'
export const REFRESH_GRACE_S = 60 * 86_400

const secretOf = (deps: Deps) => new TextEncoder().encode(deps.env.JWT_SECRET ?? 'dev-only-secret-not-for-production')

export const issueToken = (deps: Deps, d: Pick<Device, 'id' | 'role'>) =>
  new SignJWT({ role: d.role }).setProtectedHeader({ alg: 'HS256' }).setSubject(d.id).setIssuedAt().setExpirationTime(TOKEN_TTL).sign(secretOf(deps))

export async function deviceFromToken(deps: Deps, token: string, clockTolerance = 0): Promise<Device> {
  let sub: string | undefined
  try {
    sub = (await jwtVerify(token, secretOf(deps), { algorithms: ['HS256'], clockTolerance })).payload.sub
  } catch {
    throw new HttpError(401, 'invalid_token', 'Token is invalid or expired')
  }
  const device = sub ? await deps.prisma.device.findUnique({ where: { id: sub } }) : null
  if (!device) throw new HttpError(401, 'invalid_token', 'Unknown device')
  if (!device.active) throw new HttpError(401, 'deactivated', 'This device has been deactivated')
  return device
}

/** Constant-time string compare; false when the expected secret is unset. */
export function safeEqual(given: string | undefined, expected: string | undefined) {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function tokenOf(req: Parameters<RequestHandler>[0]): string | undefined {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7)
  const admin = req.headers['x-admin-token']
  return typeof admin === 'string' ? admin : undefined
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Who may call a route. Devices: Bearer JWT, filtered by `roles`. Dashboard users: session cookie,
 * filtered by `users`, with CSRF checked on every unsafe method. `admin: true` also admits the
 * ADMIN_TOKEN (header x-admin-token, scripts only). Credentials are never read from the query string.
 * Scope (which facilities) is checked by each service against the actor.
 */
export function createAuth(deps: Deps) {
  return (opts: { roles?: Role[]; admin?: boolean; users?: UserRole[] } = {}): RequestHandler =>
    async (req, res, next) => {
      const token = tokenOf(req)
      if (!token && opts.users) {
        const session = await resolveSession(deps, readCookie(req, SESSION_COOKIE))
        if (!session) throw new HttpError(401, 'unauthenticated', 'Sign in again')
        const role = session.user.role as UserRole
        if (!opts.users.includes(role)) throw new HttpError(403, 'forbidden', `Role ${role} may not call this`)
        if (!SAFE_METHODS.has(req.method)) {
          const csrf = req.headers['x-csrf-token']
          if (typeof csrf !== 'string' || !safeEqual(sha256(csrf), session.csrfHash)) throw new HttpError(403, 'csrf', 'Missing or wrong CSRF token')
        }
        const u = session.user
        res.locals.actor = { kind: 'user', user: { id: u.id, name: u.name, role, facilityId: u.facilityId, districtId: u.districtId } } satisfies Actor
        res.locals.sessionId = session.id
        return next()
      }
      if (!token) throw new HttpError(401, 'unauthenticated', 'Missing token')
      if (safeEqual(token, deps.env.ADMIN_TOKEN)) {
        if (!opts.admin) throw new HttpError(403, 'forbidden', 'Admin token not accepted here')
        res.locals.actor = { kind: 'admin' } satisfies Actor
        return next()
      }
      const device = await deviceFromToken(deps, token)
      // Fail closed: a route admits devices only when it names their roles.
      if (!opts.roles?.includes(device.role as Role)) throw new HttpError(403, 'forbidden', `Role ${device.role} may not call this`)
      res.locals.actor = { kind: 'device', device } satisfies Actor
      next()
    }
}
export type Auth = ReturnType<typeof createAuth>

export const actorOf = (res: Response) => res.locals.actor as Actor
export const deviceOf = (res: Response) => {
  const a = actorOf(res)
  if (a.kind !== 'device') throw new HttpError(403, 'forbidden', 'Device token required')
  return a.device
}
/** The acting device, or null for the admin token. */
export const deviceOrNull = (res: Response) => {
  const a = actorOf(res)
  return a.kind === 'device' ? a.device : null
}
export const userOf = (res: Response) => {
  const a = actorOf(res)
  if (a.kind !== 'user') throw new HttpError(403, 'forbidden', 'Sign in to the dashboard')
  return a.user
}
