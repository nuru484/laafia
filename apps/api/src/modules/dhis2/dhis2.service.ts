import { randomUUID } from 'node:crypto'
import { audit } from '../../platform/audit.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { assertFacility } from '../../platform/scope.ts'
import { facilityByCode } from '../referrals/index.ts'
import { buildDhis2Export, loadMapping, periodRange, type ExportInput } from './dhis2.export.ts'

/** Loads one facility's records for a month and builds the export. Bad period or unmapped facility is a 400. */
export async function exportFor(deps: Deps, actor: Actor, facilityCode: string, period: string) {
  const f = await facilityByCode(deps, facilityCode)
  await assertFacility(deps, actor, f.id)
  let start: number
  let end: number
  try {
    ;[start, end] = periodRange(period)
  } catch (e) {
    throw new HttpError(400, 'invalid_request', (e as Error).message)
  }
  const { prisma } = deps
  const clients = await prisma.client.findMany({ where: { facilityId: f.id, deleted: false }, orderBy: { code: 'asc' } })
  const visits = await prisma.visit.findMany({ where: { facilityId: f.id, deleted: false, visitedAt: { gte: start - 2 * 86_400_000, lt: end } } })
  const referrals = await prisma.referral.findMany({ where: { facilityId: f.id, deleted: false }, include: { events: { select: { at: true }, orderBy: { at: 'asc' }, take: 1 } } })
  const codeOf = new Map((await prisma.facility.findMany({ select: { id: true, code: true } })).map((x) => [x.id, x.code]))
  const input: ExportInput = {
    facility: { id: f.id, code: f.code },
    period,
    clients: clients.map((c) => ({ id: c.id, code: c.code, name: c.name, type: c.type, sex: c.sex, dob: c.dob, delivery_date: c.deliveryDate, dhis2_uid: c.dhis2Uid })),
    visits: visits.map((v) => ({ id: v.id, client_id: v.clientId, visited_at: v.visitedAt, outcome: v.outcome, rule_id: v.ruleId, muac_mm: v.muacMm, protocol_id: v.protocolId })),
    referrals: referrals.map((r) => ({
      id: r.id, client_id: r.clientId, urgency: r.urgency, danger_signs: (r.dangerSigns as string[]) ?? [], status: r.status,
      destination_code: r.destinationFacilityId ? (codeOf.get(r.destinationFacilityId) ?? null) : null,
      // Made when its first event happened; a referral with no events yet counts from its last write.
      made_at: r.events[0] ? Number(r.events[0].at) : r.updatedAt,
    })),
  }
  try {
    return buildDhis2Export(input, loadMapping(deps.env.DHIS2_MAPPING_FILE))
  } catch (e) {
    throw new HttpError(400, 'invalid_request', (e as Error).message)
  }
}

type TrackerReport = { status?: string; stats?: Record<string, number>; validationReport?: { errorReports?: { message?: string; errorCode?: string }[] } }
type AggregateReport = { status?: string; importCount?: Record<string, number>; conflicts?: { object?: string; value?: string }[]; response?: AggregateReport }

/** POSTs the export to DHIS2_BASE_URL. dryRun uses DHIS2's own dryRun + importStrategy, so nothing is written there. */
export async function pushToDhis2(deps: Deps, actor: Actor, facilityCode: string, period: string, dryRun: boolean) {
  const { DHIS2_BASE_URL: base, DHIS2_USERNAME: user, DHIS2_PASSWORD: pass } = deps.env
  if (!base || !user || !pass) throw new HttpError(503, 'dhis2_unconfigured', 'DHIS2 is not configured on this server')
  const payload = await exportFor(deps, actor, facilityCode, period)
  const headers = { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' }
  const params = new URLSearchParams({ importStrategy: 'CREATE_AND_UPDATE', dryRun: String(dryRun), async: 'false' })
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}?${params}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }).catch(() => null)
    // DHIS2 answers validation failures with a 409 and a JSON report; only a missing report is an error here.
    const json = res ? ((await res.json().catch(() => null)) as T | null) : null
    if (!json) {
      deps.logger.warn('dhis2_push_failed', { path, status: res?.status ?? 'network' })
      throw new HttpError(502, 'dhis2_error', `DHIS2 request failed (${res?.status ?? 'network'})`)
    }
    return json
  }
  const tracker = await post<TrackerReport>('/api/tracker', payload.tracker)
  const agg = await post<AggregateReport>('/api/dataValueSets', payload.dataValueSet)
  const aggregate = agg.response ?? agg // 2.38+ wraps the import summary in `response`
  const report = {
    dry_run: dryRun,
    tracked_entities: payload.tracker.trackedEntities.length,
    tracker: { status: tracker.status ?? null, stats: tracker.stats ?? null, errors: (tracker.validationReport?.errorReports ?? []).slice(0, 20).map((e) => ({ code: e.errorCode ?? null, message: e.message ?? '' })) },
    aggregate: { status: aggregate.status ?? null, import_count: aggregate.importCount ?? null, conflicts: (aggregate.conflicts ?? []).slice(0, 20) },
  }
  const ok = report.tracker.status === 'OK' && report.aggregate.status === 'SUCCESS'
  const f = await facilityByCode(deps, facilityCode)
  const runId = randomUUID()
  await deps.prisma.exportRun.create({
    data: { id: runId, facilityId: f.id, period, dryRun, actor: actorName(actor), at: deps.clock(), trackedEntities: report.tracked_entities, status: ok ? 'ok' : 'error', result: report },
  })
  await audit(deps, actor, 'export.push', { type: 'export', id: runId, districtId: f.districtId }, { facility: f.code, period, dry_run: dryRun, status: ok ? 'ok' : 'error' })
  return { ...report, run_id: runId, status: ok ? 'ok' : 'error' }
}

const actorName = (actor: Actor) => (actor.kind === 'user' ? actor.user.name : actor.kind === 'device' ? actor.device.userName : 'Admin token')

type Run = { id: string; facilityId: string; period: string; dryRun: boolean; actor: string; at: number; trackedEntities: number; status: string; result: unknown }
const runView = (r: Run, code: string) => ({ id: r.id, facility_code: code, period: r.period, dry_run: r.dryRun, actor: r.actor, at: r.at, tracked_entities: r.trackedEntities, status: r.status, result: r.result })

/** Export history for one facility, newest first. */
export async function exportHistory(deps: Deps, actor: Actor, facilityCode: string, limit: number) {
  const f = await facilityByCode(deps, facilityCode)
  await assertFacility(deps, actor, f.id)
  const runs = await deps.prisma.exportRun.findMany({ where: { facilityId: f.id }, orderBy: { at: 'desc' }, take: limit })
  return { runs: runs.map((r) => runView(r, f.code)) }
}

/** The last `months` complete months and whether each has had a successful real (not dry-run) export. */
export async function pendingPeriods(deps: Deps, actor: Actor, facilityCode: string, months: number) {
  const f = await facilityByCode(deps, facilityCode)
  await assertFacility(deps, actor, f.id)
  const now = new Date(deps.clock())
  const periods: string[] = []
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    periods.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const runs = await deps.prisma.exportRun.findMany({ where: { facilityId: f.id, period: { in: periods } }, orderBy: { at: 'desc' } })
  return {
    facility_code: f.code,
    periods: periods.map((period) => {
      const mine = runs.filter((r) => r.period === period)
      const real = mine.find((r) => !r.dryRun && r.status === 'ok')
      return { period, exported: !!real, exported_at: real?.at ?? null, last_run: mine[0] ? runView(mine[0], f.code) : null }
    }),
  }
}
