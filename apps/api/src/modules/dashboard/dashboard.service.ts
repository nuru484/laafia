import { referralAlert, type ReferralStatus } from '@laafia/core'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { districtOrThrow, staffFacility } from '../../platform/scope.ts'

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

/**
 * Overview tiles: today's referrals by state, open alerts by the core rules (no acknowledgement within the
 * urgency's timeout; acknowledged but not arrived within its window), 30-day completion rate and median time
 * to acknowledge, and devices that have not synced for 3 days. District users see their district,
 * facility staff their facility.
 */
export async function overview(deps: Deps, actor: Actor, districtCode?: string) {
  const now = deps.clock()
  let facilityIds: string[]
  let district: { id: string; code: string; name: string } | null = null
  const own = staffFacility(actor) // throws for facility staff with no facility
  if (own) facilityIds = [own]
  else {
    district = await districtFor(deps, actor, districtCode)
    facilityIds = (await deps.prisma.facility.findMany({ where: { districtId: district.id }, select: { id: true } })).map((f) => f.id)
  }
  const staffView = own !== null
  const referrals = await deps.prisma.referral.findMany({
    where: { deleted: false, ...(staffView ? { destinationFacilityId: { in: facilityIds } } : { OR: [{ facilityId: { in: facilityIds } }, { destinationFacilityId: { in: facilityIds } }] }) },
    include: { events: { select: { status: true, at: true }, orderBy: { at: 'asc' } } },
  })
  const startOfDay = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  const made = (r: (typeof referrals)[number]) => (r.events[0] ? Number(r.events[0].at) : null)
  const today = referrals.filter((r) => (made(r) ?? 0) >= startOfDay)
  const alertOf = (r: (typeof referrals)[number]) =>
    referralAlert(r.events.map((e) => ({ status: e.status as ReferralStatus, at: Number(e.at) })), (r.urgency ?? 1) as 1 | 2 | 3, now)
  const brief = (r: (typeof referrals)[number]) => ({ id: r.id, short_id: r.shortId, client_code: r.clientCode, urgency: r.urgency, status: r.status, destination_facility_id: r.destinationFacilityId, made_at: made(r) })
  const recent = referrals.filter((r) => (made(r) ?? 0) >= now - 30 * DAY)
  const nc = recent.filter((r) => r.status !== 'cancelled')
  const acks = recent.flatMap((r) => {
    const first = made(r)
    const rec = r.events.find((e) => e.status === 'received')
    return first !== null && rec ? [Number(rec.at) - first] : []
  })
  const devices = staffView
    ? []
    : await deps.prisma.device.findMany({ where: { facilityId: { in: facilityIds }, active: true, role: { in: ['cho', 'volunteer', 'facility'] } }, select: { id: true, role: true, userName: true, facilityId: true } })
  const status = new Map((await deps.prisma.deviceStatus.findMany({ where: { deviceId: { in: devices.map((d) => d.id) } } })).map((s) => [s.deviceId, s.lastSyncAt]))
  const stale = devices
    .map((d) => ({ id: d.id, role: d.role, user_name: d.userName, facility_id: d.facilityId, last_sync_at: status.get(d.id) ?? null }))
    .filter((d) => d.last_sync_at === null || d.last_sync_at < now - 3 * DAY)
  return {
    scope: staffView ? { facility_id: facilityIds[0] ?? null } : { district },
    today: { total: today.length, by_status: Object.fromEntries(STATES.map((s) => [s, today.filter((r) => r.status === s).length])) },
    overdue_acknowledgements: referrals.filter((r) => alertOf(r) === 'no_ack').map(brief),
    did_not_arrive: referrals.filter((r) => alertOf(r) === 'not_arrived').map(brief),
    completion_rate_30d: nc.length ? nc.filter((r) => r.status === 'treated' || r.status === 'closed').length / nc.length : null,
    median_ack_minutes_30d: minutes(median(acks)),
    devices_not_synced_3d: stale,
  }
}

async function districtFor(deps: Deps, actor: Actor, code?: string) {
  if (actor.kind === 'user') return deps.prisma.district.findUniqueOrThrow({ where: { id: districtOrThrow(actor) } })
  if (actor.kind === 'admin' && code) {
    const d = await deps.prisma.district.findUnique({ where: { code } })
    if (d) return d
  }
  throw new HttpError(400, 'invalid_request', 'No district in scope')
}

export async function summary(deps: Deps, actor: Actor, days: number, districtCode?: string) {
  // Facility staff get their own facility's history; district users the whole district.
  const ownFacility = staffFacility(actor) // throws for facility staff with no facility
  const district = ownFacility ? null : await districtFor(deps, actor, districtCode)
  const facilities = await deps.prisma.facility.findMany({ where: ownFacility ? { id: ownFacility } : { districtId: district!.id }, select: { id: true, code: true, name: true, level: true }, orderBy: { code: 'asc' } })
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
    district: district ? { id: district.id, code: district.code, name: district.name } : null,
    facility: ownFacility ? facilities[0] ?? null : null,
    window_days: days,
    total: rows.length,
    by_status: byStatus,
    time_to_ack_minutes: { median: minutes(median(acks)), p90: minutes(quantile(acks, 0.9)), count: acks.length },
    completion_rate: notCancelled.length ? done.length / notCancelled.length : null,
    per_facility: perFacility,
    daily,
  }
}
