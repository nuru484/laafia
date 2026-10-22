import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Actor } from '../../platform/middleware/auth.ts'

/*
 * Supervisor view (spec 2, 17): referral flow for one district over a window. A referral counts
 * from its first event; time to acknowledge runs from that first event to the first `received`.
 * Completion = treated or closed, out of referrals that were not cancelled.
 */

const DAY = 86_400_000
const STATES = ['created', 'carrying', 'sent', 'received', 'arrived', 'treated', 'closed', 'cancelled'] as const

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!
}
const minutes = (ms: number | null) => (ms === null ? null : Math.round(ms / 60_000))

async function districtFor(deps: Deps, actor: Actor, code?: string) {
  if (actor.kind === 'user' && actor.user.districtId) return deps.prisma.district.findUniqueOrThrow({ where: { id: actor.user.districtId } })
  if (actor.kind === 'admin' && code) {
    const d = await deps.prisma.district.findUnique({ where: { code } })
    if (d) return d
  }
  throw new HttpError(400, 'invalid_request', 'No district in scope')
}

export async function summary(deps: Deps, actor: Actor, days: number, districtCode?: string) {
  const district = await districtFor(deps, actor, districtCode)
  const facilities = await deps.prisma.facility.findMany({ where: { districtId: district.id }, select: { id: true, code: true, name: true, level: true }, orderBy: { code: 'asc' } })
  const ids = facilities.map((f) => f.id)
  const now = deps.clock()
  const since = now - days * DAY
  const referrals = await deps.prisma.referral.findMany({
    where: { deleted: false, OR: [{ facilityId: { in: ids } }, { destinationFacilityId: { in: ids } }] },
    include: { events: { select: { status: true, at: true }, orderBy: { at: 'asc' } } },
  })
  const rows = referrals
    .map((r) => {
      const first = r.events[0]?.at ?? null
      const received = r.events.find((e) => e.status === 'received')?.at ?? null
      return { ...r, madeAt: first === null ? null : Number(first), ackMs: first !== null && received !== null ? Number(received) - Number(first) : null }
    })
    .filter((r) => r.madeAt !== null && r.madeAt >= since)

  const byStatus = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.status === s).length]))
  const notCancelled = rows.filter((r) => r.status !== 'cancelled')
  const done = notCancelled.filter((r) => r.status === 'treated' || r.status === 'closed')
  const acks = rows.map((r) => r.ackMs).filter((x): x is number => x !== null)

  const perFacility = facilities.map((f) => {
    const inbound = rows.filter((r) => r.destinationFacilityId === f.id)
    const nc = inbound.filter((r) => r.status !== 'cancelled')
    const fa = inbound.map((r) => r.ackMs).filter((x): x is number => x !== null)
    return {
      facility: f,
      referred_from: rows.filter((r) => r.facilityId === f.id).length,
      received: inbound.length,
      open: inbound.filter((r) => !['treated', 'closed', 'cancelled'].includes(r.status)).length,
      median_ack_minutes: minutes(median(fa)),
      completion_rate: nc.length ? nc.filter((r) => r.status === 'treated' || r.status === 'closed').length / nc.length : null,
    }
  })

  const daily: { day: string; referrals: number; completed: number }[] = []
  for (let t = Date.UTC(new Date(since).getUTCFullYear(), new Date(since).getUTCMonth(), new Date(since).getUTCDate()); t <= now; t += DAY) {
    const inDay = rows.filter((r) => r.madeAt! >= t && r.madeAt! < t + DAY)
    daily.push({ day: new Date(t).toISOString().slice(0, 10), referrals: inDay.length, completed: inDay.filter((r) => r.status === 'treated' || r.status === 'closed').length })
  }

  return {
    district: { id: district.id, code: district.code, name: district.name },
    window_days: days,
    total: rows.length,
    by_status: byStatus,
    time_to_ack_minutes: { median: minutes(median(acks)), p90: minutes(quantile(acks, 0.9)), count: acks.length },
    completion_rate: notCancelled.length ? done.length / notCancelled.length : null,
    per_facility: perFacility,
    daily,
  }
}
