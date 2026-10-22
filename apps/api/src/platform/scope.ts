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
  if (u.role === 'facility_staff') return [staffFacility(actor)!]
  return (await deps.prisma.facility.findMany({ where: { districtId: districtOrThrow(actor) }, select: { id: true } })).map((f) => f.id)
}

/**
 * Scope comes from the role, never from which ids happen to be set: facility staff without a facility,
 * or a district role without a district, are refused rather than widened.
 * Returns the staff user's facility, or null for any other actor.
 */
export function staffFacility(actor: Actor): string | null {
  if (actor.kind !== 'user' || actor.user.role !== 'facility_staff') return null
  if (!actor.user.facilityId) throw new HttpError(403, 'forbidden', 'No facility assigned')
  return actor.user.facilityId
}

export function districtOrThrow(actor: Actor & { kind: 'user' }): string {
  if (!actor.user.districtId) throw new HttpError(403, 'forbidden', 'No district assigned')
  return actor.user.districtId
}

export const inScope = (scope: string[] | null, facilityId: string | null | undefined) => scope === null || (!!facilityId && scope.includes(facilityId))

/** 403 unless the facility is in the actor's scope. */
export async function assertFacility(deps: Deps, actor: Actor, facilityId: string | null | undefined) {
  if (!inScope(await facilityScope(deps, actor), facilityId)) throw new HttpError(403, 'forbidden', 'Outside your facility or district')
}

