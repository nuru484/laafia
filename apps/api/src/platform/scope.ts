import type { Deps } from './deps.ts'
import { HttpError } from './http/errors.ts'
import type { Actor } from './middleware/auth.ts'

/**
 * Facilities an actor may see: null means every facility (the script admin token).
 * A device and facility staff see their own facility; a district admin or supervisor every
 * facility in their district.
 */
export async function facilityScope(deps: Deps, actor: Actor): Promise<string[] | null> {
  if (actor.kind === 'admin') return null
  if (actor.kind === 'device') return actor.device.facilityId ? [actor.device.facilityId] : []
  const u = actor.user
  if (u.role === 'facility_staff') return u.facilityId ? [u.facilityId] : []
  if (!u.districtId) return []
  return (await deps.prisma.facility.findMany({ where: { districtId: u.districtId }, select: { id: true } })).map((f) => f.id)
}

export const inScope = (scope: string[] | null, facilityId: string | null | undefined) => scope === null || (!!facilityId && scope.includes(facilityId))

/** 403 unless the facility is in the actor's scope. */
export async function assertFacility(deps: Deps, actor: Actor, facilityId: string | null | undefined) {
  if (!inScope(await facilityScope(deps, actor), facilityId)) throw new HttpError(403, 'forbidden', 'Outside your facility or district')
}

/** The district a user administers; the admin token may name any. */
export function districtOf(actor: Actor): string | null {
  return actor.kind === 'user' ? actor.user.districtId : null
}
