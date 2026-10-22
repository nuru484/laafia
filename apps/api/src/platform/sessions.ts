import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import type { Deps } from './deps.ts'

/*
 * Web dashboard sessions: an opaque random token in an httpOnly cookie, stored hashed.
 * Server-side state gives immediate revocation on logout, password reset or deactivation.
 * CSRF: double submit tied to the session. The CSRF token is returned at login and also set
 * in a script-readable cookie; mutations must echo it in the X-CSRF-Token header.
 */

export const SESSION_COOKIE = 'laafia_session'
export const CSRF_COOKIE = 'laafia_csrf'
export const SESSION_ABSOLUTE_MS = 7 * 86_400_000
export const SESSION_IDLE_MS = 12 * 3_600_000
const TOUCH_EVERY_MS = 60_000

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

const base = (deps: Deps): CookieOptions => ({ secure: deps.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' })

export async function createSession(deps: Deps, userId: string) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(32).toString('base64url')
  const now = deps.clock()
  await deps.prisma.webSession.create({
    data: { id: randomUUID(), userId, tokenHash: sha256(token), csrfHash: sha256(csrf), expiresAt: now + SESSION_ABSOLUTE_MS, lastSeenAt: now, createdAt: now },
  })
  return { token, csrf }
}

export function setSessionCookies(deps: Deps, res: Response, s: { token: string; csrf: string }) {
  res.cookie(SESSION_COOKIE, s.token, { ...base(deps), httpOnly: true, maxAge: SESSION_ABSOLUTE_MS })
  res.cookie(CSRF_COOKIE, s.csrf, { ...base(deps), httpOnly: false, maxAge: SESSION_ABSOLUTE_MS })
}

export function clearSessionCookies(deps: Deps, res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...base(deps), httpOnly: true })
  res.clearCookie(CSRF_COOKIE, { ...base(deps), httpOnly: false })
}

/** The live session for a cookie token, or null if unknown, revoked, expired, idle too long, or its user is inactive. */
export async function resolveSession(deps: Deps, token: string | undefined) {
  if (!token) return null
  const s = await deps.prisma.webSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
  const now = deps.clock()
  if (!s || s.revokedAt !== null || s.expiresAt <= now || s.lastSeenAt + SESSION_IDLE_MS <= now || !s.user.active) return null
  if (now - s.lastSeenAt > TOUCH_EVERY_MS) await deps.prisma.webSession.update({ where: { id: s.id }, data: { lastSeenAt: now } })
  return s
}

export async function revokeSessions(deps: Deps, where: { id?: string; userId?: string }) {
  await deps.prisma.webSession.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: deps.clock() } })
}
