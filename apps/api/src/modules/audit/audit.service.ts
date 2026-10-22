import type { Deps } from '../../platform/deps.ts'
import type { Actor } from '../../platform/middleware/auth.ts'

/** Newest first, paged by `before` (an `at` from the previous page). District admins see their district only. */
export async function listAudit(deps: Deps, actor: Actor, q: { limit: number; before?: number; target_type?: string }) {
  const rows = await deps.prisma.auditEvent.findMany({
    where: {
      ...(actor.kind === 'user' ? { districtId: actor.user.districtId ?? '' } : {}),
      ...(q.before ? { at: { lt: q.before } } : {}),
      ...(q.target_type ? { targetType: q.target_type } : {}),
    },
    orderBy: { at: 'desc' },
    take: q.limit + 1,
  })
  const page = rows.slice(0, q.limit)
  return {
    events: page.map((e) => ({ id: e.id, at: e.at, actor_kind: e.actorKind, actor_id: e.actorId, actor_name: e.actorName, action: e.action, target_type: e.targetType, target_id: e.targetId, details: e.details })),
    next_before: rows.length > q.limit ? page[page.length - 1]!.at : null,
  }
}
