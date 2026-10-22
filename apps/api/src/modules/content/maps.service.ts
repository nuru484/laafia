import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { audit } from '../../platform/audit.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Bbox } from '../../platform/map-extractor.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { districtOrThrow } from '../../platform/scope.ts'
import { addPack, contentDir } from './content.service.ts'

/** About 2 km, so the households at the edge of the catchment are not on the map's border. */
const MARGIN = 0.02
const round = (v: number) => Math.round(v * 1e4) / 1e4

type Build = { id: string; bbox: number[]; status: string; error: string | null; startedAt: number; finishedAt: number | null; pack: { version: number } | null }
const view = (b: Build) => ({
  id: b.id, bbox: b.bbox as Bbox, status: b.status, error: b.error, pack_version: b.pack?.version ?? null, started_at: b.startedAt, finished_at: b.finishedAt,
})

async function districtFor(deps: Deps, actor: Actor, code: string) {
  const district = await deps.prisma.district.findUnique({ where: { code }, select: { id: true, code: true } })
  if (!district) throw new HttpError(404, 'not_found', 'Unknown district')
  if (actor.kind === 'user' && districtOrThrow(actor) !== district.id) throw new HttpError(403, 'forbidden', 'Outside your district')
  return district
}

/** The box around every facility and household with GPS in the district, plus a margin; null when none has GPS. */
async function suggestedArea(deps: Deps, districtId: string) {
  const facilities = await deps.prisma.facility.findMany({ where: { districtId, deleted: false }, select: { id: true, lat: true, lng: true } })
  const homes = await deps.prisma.household.aggregate({
    where: { facilityId: { in: facilities.map((f) => f.id) }, deleted: false, lat: { not: null }, lng: { not: null } },
    _min: { lat: true, lng: true }, _max: { lat: true, lng: true }, _count: true,
  })
  const lngs = [...facilities.map((f) => f.lng), homes._min.lng, homes._max.lng].filter((v): v is number => v !== null)
  const lats = [...facilities.map((f) => f.lat), homes._min.lat, homes._max.lat].filter((v): v is number => v !== null)
  if (!lngs.length) return null
  const bbox: Bbox = [round(Math.min(...lngs) - MARGIN), round(Math.min(...lats) - MARGIN), round(Math.max(...lngs) + MARGIN), round(Math.max(...lats) + MARGIN)]
  return { bbox, facilities: facilities.length, households: homes._count }
}

const latestBuild = (deps: Deps, districtId: string) =>
  deps.prisma.mapBuild.findFirst({ where: { districtId }, orderBy: { startedAt: 'desc' }, include: { pack: { select: { version: true } } } })

export async function mapArea(deps: Deps, actor: Actor, code: string) {
  const district = await districtFor(deps, actor, code)
  const [suggested, build, lastDone] = await Promise.all([
    suggestedArea(deps, district.id),
    latestBuild(deps, district.id),
    deps.prisma.mapBuild.findFirst({ where: { districtId: district.id, status: 'done' }, orderBy: { startedAt: 'desc' }, select: { bbox: true } }),
  ])
  return { district_code: district.code, suggested, last_bbox: (lastDone?.bbox as Bbox | undefined) ?? null, build: build ? view(build) : null }
}

/**
 * Starts cutting the district map and answers at once; the dashboard polls mapArea for the result.
 * The district row lock makes "is one already running" and the insert one step, so two clicks start one build.
 */
export async function startBuild(deps: Deps, actor: Actor, code: string, bbox: Bbox) {
  const district = await districtFor(deps, actor, code)
  const build = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM districts WHERE id = ${district.id} FOR UPDATE`
    if (await tx.mapBuild.findFirst({ where: { districtId: district.id, status: 'running' }, select: { id: true } })) {
      throw new HttpError(409, 'map_build_running', 'A map for this district is already being made')
    }
    return tx.mapBuild.create({ data: { id: randomUUID(), districtId: district.id, bbox, status: 'running', startedAt: deps.clock() }, include: { pack: { select: { version: true } } } })
  })
  await audit(deps, actor, 'map.build', { type: 'map_build', id: build.id, districtId: district.id }, { district: district.code, bbox })
  void runBuild(deps, actor, district.code, build.id, bbox)
  return view(build)
}

async function runBuild(deps: Deps, actor: Actor, districtCode: string, id: string, bbox: Bbox) {
  const incoming = join(contentDir(deps), '.incoming')
  const out = join(incoming, `${randomUUID()}.pmtiles`)
  try {
    await mkdir(incoming, { recursive: true })
    const { source } = await deps.maps.extract(bbox, out)
    const pack = await addPack(deps, actor, { path: out, size: (await stat(out)).size }, { kind: 'tiles', district_code: districtCode })
    await deps.prisma.mapBuild.update({ where: { id }, data: { status: 'done', packId: pack.id, finishedAt: deps.clock() } })
    deps.logger.info('map_build_done', { build_id: id, district: districtCode, version: pack.version, size: pack.size, source })
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    await deps.prisma.mapBuild.update({ where: { id }, data: { status: 'failed', error, finishedAt: deps.clock() } }).catch(() => {})
    deps.logger.warn('map_build_failed', { build_id: id, district: districtCode, error })
  } finally {
    await rm(out, { force: true })
  }
}

/**
 * A build runs inside the API process, so one still marked running at boot died with the last process.
 * ponytail: assumes a single API instance; with several, record the owning instance and expire by heartbeat.
 */
export async function failInterruptedBuilds(deps: Deps) {
  await deps.prisma.mapBuild.updateMany({ where: { status: 'running' }, data: { status: 'failed', error: 'Interrupted by a server restart', finishedAt: deps.clock() } })
}
