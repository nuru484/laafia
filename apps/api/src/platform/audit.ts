import { randomUUID } from 'node:crypto'
import type { Tx } from './db.ts'
import type { Deps } from './deps.ts'
import type { Actor } from './middleware/auth.ts'

/** Records one admin action. Details hold ids and counts, never passwords, keys or message bodies. */
export async function audit(
  deps: Deps,
  actor: Actor,
  action: string,
  target: { type: string; id?: string | null; districtId?: string | null },
  details: Record<string, unknown> = {},
  tx?: Tx,
) {
  const who =
    actor.kind === 'user' ? { actorKind: 'user', actorId: actor.user.id, actorName: actor.user.name }
    : actor.kind === 'device' ? { actorKind: 'device', actorId: actor.device.id, actorName: actor.device.userName }
    : { actorKind: 'script', actorId: null, actorName: 'Admin token' }
  const districtId = target.districtId ?? (actor.kind === 'user' ? actor.user.districtId : null)
  await (tx ?? deps.prisma).auditEvent.create({
    data: { id: randomUUID(), at: deps.clock(), ...who, action, targetType: target.type, targetId: target.id ?? null, districtId, details: details as object },
  })
}

/** District of a facility, for scoping audit rows and lists. */
export async function districtOfFacility(deps: Deps, facilityId: string | null | undefined) {
  if (!facilityId) return null
  return (await deps.prisma.facility.findUnique({ where: { id: facilityId }, select: { districtId: true } }))?.districtId ?? null
}
