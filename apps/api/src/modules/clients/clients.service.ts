import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { audit, districtOfFacility } from '../../platform/audit.ts'
import { facilityScope, inScope } from '../../platform/scope.ts'

export type DuplicateClient = {
  id: string; code: string; name: string; type: string; phone: string | null; community: string; head_name: string
  facility_id: string | null; device_id: string | null; updated_at: number; visits: number; referrals: number
}
export type DuplicateGroup = { reason: 'same phone' | 'same name'; clients: DuplicateClient[] }

const words = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim()

/**
 * Clients the phones may have enrolled twice, which no single phone can see: the same phone number, or the same
 * name and type in the same community. A person decides; two neighbours can share a name.
 */
export async function duplicates(deps: Deps, actor: Actor): Promise<DuplicateGroup[]> {
  const scope = await facilityScope(deps, actor)
  const clients = await deps.prisma.client.findMany({
    where: { deleted: false, ...(scope ? { facilityId: { in: scope } } : {}) },
    select: { id: true, code: true, name: true, type: true, phone: true, householdId: true, facilityId: true, deviceId: true, updatedAt: true },
  })
  const houses = new Map((await deps.prisma.household.findMany({ where: { id: { in: [...new Set(clients.map((c) => c.householdId))] } }, select: { id: true, community: true, headName: true } })).map((h) => [h.id, h]))
  const buckets = new Map<string, { reason: DuplicateGroup['reason']; ids: string[] }>()
  for (const c of clients) {
    const h = houses.get(c.householdId)
    if (c.phone) (buckets.get(`p:${c.phone}`) ?? buckets.set(`p:${c.phone}`, { reason: 'same phone', ids: [] }).get(`p:${c.phone}`)!).ids.push(c.id)
    const key = `n:${c.type}|${words(c.name)}|${words(h?.community ?? '')}`
    ;(buckets.get(key) ?? buckets.set(key, { reason: 'same name', ids: [] }).get(key)!).ids.push(c.id)
  }
  // A pair found both ways is listed once, under its phone number.
  const seen = new Set<string>()
  const groups = [...buckets.values()].filter((b) => b.ids.length > 1).sort((a, b) => (a.reason === b.reason ? 0 : a.reason === 'same phone' ? -1 : 1)).filter((b) => {
    const key = [...b.ids].sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const ids = groups.flatMap((g) => g.ids)
  const visitCounts = new Map((await deps.prisma.visit.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, deleted: false }, _count: true })).map((v) => [v.clientId, v._count]))
  const referralCounts = new Map((await deps.prisma.referral.groupBy({ by: ['clientId'], where: { clientId: { in: ids }, deleted: false }, _count: true })).map((r) => [r.clientId, r._count]))
  const byId = new Map(clients.map((c) => [c.id, c]))
  return groups.map((g) => ({
    reason: g.reason,
    clients: g.ids.map((id) => {
      const c = byId.get(id)!
      const h = houses.get(c.householdId)
      return {
        id, code: c.code, name: c.name, type: c.type, phone: c.phone, community: h?.community ?? '', head_name: h?.headName ?? '',
        facility_id: c.facilityId, device_id: c.deviceId, updated_at: Number(c.updatedAt), visits: visitCounts.get(id) ?? 0, referrals: referralCounts.get(id) ?? 0,
      }
    }),
  }))
}

/**
 * Folds a duplicate into the record kept: its visits and referrals move across (into the kept record's catchment),
 * a phone number the kept record lacks is taken over, and the duplicate is removed. The sync sequence moves on
 * every changed row, so each phone gets the merge on its next pull.
 */
export async function mergeClient(deps: Deps, actor: Actor, dupId: string, keepId: string) {
  if (dupId === keepId) throw new HttpError(400, 'invalid_request', 'Choose two different clients')
  const scope = await facilityScope(deps, actor)
  const [dup, keep] = await Promise.all([dupId, keepId].map((id) => deps.prisma.client.findFirst({ where: { id, deleted: false } })))
  // Outside the district answers not found, like an unknown id.
  if (!dup || !keep || !inScope(scope, dup.facilityId) || !inScope(scope, keep.facilityId)) throw new HttpError(404, 'not_found', 'Unknown client')
  if (dup.type !== keep.type) throw new HttpError(400, 'different_types', 'Only clients of the same type can be merged')
  const now = BigInt(deps.clock())
  const moved = await write(deps.prisma, async (tx) => {
    const visits = await tx.visit.updateMany({ where: { clientId: dupId }, data: { clientId: keepId, facilityId: keep.facilityId, updatedAt: now } })
    const referrals = await tx.referral.updateMany({ where: { clientId: dupId }, data: { clientId: keepId, updatedAt: now } })
    if (!keep.phone && dup.phone) await tx.client.update({ where: { id: keepId }, data: { phone: dup.phone, updatedAt: now } })
    await tx.client.update({ where: { id: dupId }, data: { deleted: true, updatedAt: now } })
    return { visits: visits.count, referrals: referrals.count }
  })
  await audit(deps, actor, 'client.merge', { type: 'client', id: dupId, districtId: await districtOfFacility(deps, keep.facilityId) }, { into: keepId, ...moved })
  return { kept: keepId, moved }
}
