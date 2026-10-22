import { normalizePhone } from '@laafia/core'
import { randomUUID } from 'node:crypto'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Actor, UserRole } from '../../platform/middleware/auth.ts'
import { hashPassword, verifyPassword } from '../../platform/passwords.ts'
import { audit, districtOfFacility } from '../../platform/audit.ts'
import { districtOrThrow } from '../../platform/scope.ts'
import { createSession, revokeSessions } from '../../platform/sessions.ts'
import type { CreateUserInput } from './users.schemas.ts'

type UserRow = { id: string; name: string; email: string | null; phone: string | null; role: string; facilityId: string | null; districtId: string | null; active: boolean; lastLoginAt: number | null; createdAt: number }

export const userView = (u: UserRow) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role as UserRole, facility_id: u.facilityId, district_id: u.districtId,
  active: u.active, last_login_at: u.lastLoginAt, created_at: u.createdAt,
})

/** The district a facility_staff user belongs to comes from their facility. */
async function withScope(deps: Deps, u: UserRow) {
  const facility = u.facilityId ? await deps.prisma.facility.findUnique({ where: { id: u.facilityId }, select: { code: true, name: true, districtId: true } }) : null
  const districtId = u.districtId ?? facility?.districtId ?? null
  const district = districtId ? await deps.prisma.district.findUnique({ where: { id: districtId }, select: { code: true, name: true } }) : null
  return { ...userView(u), facility: facility ? { id: u.facilityId, code: facility.code, name: facility.name } : null, district: district ? { id: districtId, ...district } : null }
}

const identifier = (login: string) => (login.includes('@') ? { email: login.toLowerCase() } : { phone: normalizePhone(login) })

/** Same answer for unknown, inactive and wrong-password, so login does not reveal which accounts exist. */
export async function login(deps: Deps, loginId: string, password: string) {
  const user = await deps.prisma.user.findFirst({ where: identifier(loginId) })
  // Hash anyway for an unknown account, so response time does not reveal which accounts exist.
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, DUMMY_HASH), false)
  if (!user || !ok || !user.active) throw new HttpError(401, 'invalid_credentials', 'Wrong email/phone or password')
  const updated = await deps.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: deps.clock() } })
  const session = await createSession(deps, user.id)
  return { session, user: await withScope(deps, updated) }
}
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export async function me(deps: Deps, userId: string) {
  return withScope(deps, await deps.prisma.user.findUniqueOrThrow({ where: { id: userId } }))
}

/** District of the acting admin: their own, or for the script token the one named in the request. */
async function adminDistrict(deps: Deps, actor: Actor, districtCode?: string) {
  if (actor.kind === 'user') return districtOrThrow(actor)
  if (!districtCode) return null
  const d = await deps.prisma.district.findUnique({ where: { code: districtCode } })
  if (!d) throw new HttpError(404, 'not_found', 'Unknown district')
  return d.id
}

const inDistrict = (districtId: string) => ({ OR: [{ districtId }, { facility: { districtId } }] })

export async function listUsers(deps: Deps, actor: Actor) {
  const where = actor.kind === 'user' ? inDistrict(districtOrThrow(actor)) : {}
  return (await deps.prisma.user.findMany({ where, orderBy: [{ role: 'asc' }, { name: 'asc' }] })).map(userView)
}

/** District admins create accounts within their own district only. */
export async function createUser(deps: Deps, actor: Actor, body: CreateUserInput) {
  const districtId = await adminDistrict(deps, actor, body.district_code)
  let facilityId: string | null = null
  if (body.role === 'facility_staff') {
    const f = await deps.prisma.facility.findUnique({ where: { code: body.facility_code! } })
    if (!f) throw new HttpError(404, 'not_found', 'Unknown facility code')
    if (actor.kind === 'user' && f.districtId !== districtId) throw new HttpError(403, 'forbidden', 'Outside your district')
    facilityId = f.id
  } else if (!districtId) throw new HttpError(400, 'invalid_request', 'district_code is required')
  const email = body.email?.toLowerCase() ?? null
  const phone = body.phone ? normalizePhone(body.phone) : null
  const clash = await deps.prisma.user.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] }, select: { id: true } })
  if (clash) throw new HttpError(409, 'conflict', 'That email or phone already has an account')
  const now = deps.clock()
  const user = await deps.prisma.user.create({
    data: {
      id: randomUUID(), name: body.name, email, phone, passwordHash: await hashPassword(body.password), role: body.role,
      facilityId, districtId: body.role === 'facility_staff' ? null : districtId, passwordChangedAt: now, createdAt: now,
    },
  })
  await audit(deps, actor, 'user.create', { type: 'user', id: user.id, districtId: user.districtId ?? (await districtOfFacility(deps, user.facilityId)) }, { role: user.role })
  return userView(user)
}

async function userInScope(deps: Deps, actor: Actor, id: string) {
  const where = actor.kind === 'user' ? { id, ...inDistrict(districtOrThrow(actor)) } : { id }
  const u = await deps.prisma.user.findFirst({ where })
  if (!u) throw new HttpError(404, 'not_found', 'Unknown user')
  return u
}

/** Admin password reset: every session of that user ends. */
export async function resetPassword(deps: Deps, actor: Actor, id: string, password: string) {
  const u = await userInScope(deps, actor, id)
  const updated = await deps.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(password), passwordChangedAt: deps.clock() } })
  await revokeSessions(deps, { userId: u.id })
  await audit(deps, actor, 'user.password_reset', { type: 'user', id: u.id, districtId: u.districtId ?? (await districtOfFacility(deps, u.facilityId)) })
  return userView(updated)
}

export async function setActive(deps: Deps, actor: Actor, id: string, active: boolean) {
  if (actor.kind === 'user' && actor.user.id === id) throw new HttpError(400, 'invalid_request', 'You cannot deactivate your own account')
  const u = await userInScope(deps, actor, id)
  const updated = await deps.prisma.user.update({ where: { id: u.id }, data: { active } })
  if (!active) await revokeSessions(deps, { userId: u.id })
  await audit(deps, actor, active ? 'user.activate' : 'user.deactivate', { type: 'user', id: u.id, districtId: u.districtId ?? (await districtOfFacility(deps, u.facilityId)) })
  return userView(updated)
}
