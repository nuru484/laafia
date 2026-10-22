import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Device } from '../../platform/middleware/auth.ts'
import type { UploadFields } from './content.schemas.ts'

/*
 * Content packs (audio clips per language, PMTiles per district) live on disk
 * under CONTENT_DIR, named by pack id. Downloads answer Range requests, so a
 * phone on a poor network resumes where it stopped.
 */

export const contentDir = (deps: Deps) => resolve(deps.env.CONTENT_DIR)
const EXT = { audio: '.zip', tiles: '.pmtiles' } as const
const TYPE = { audio: 'application/zip', tiles: 'application/vnd.pmtiles' } as const

const sha256File = (path: string) =>
  new Promise<string>((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', fail)
  })

type Pack = { id: string; kind: string; language: string | null; version: number; size: number; sha256: string; contentType: string; createdAt: number }
const view = (p: Pack, districtCode: string | null) => ({
  id: p.id, kind: p.kind, language: p.language, district_code: districtCode, version: p.version, size: p.size, sha256: p.sha256,
  content_type: p.contentType, url: `/content/packs/${p.id}`, created_at: p.createdAt,
})

/** Stores an uploaded file (already on disk at `file.path`) as a new pack version; computes size and sha256. */
export async function addPack(deps: Deps, file: { path: string; size: number }, f: UploadFields) {
  if (f.kind === 'audio' && !f.language) throw new HttpError(400, 'invalid_request', 'Audio packs need a language')
  if (f.kind === 'tiles' && !f.district_code) throw new HttpError(400, 'invalid_request', 'Tile packs need a district_code')
  const district = f.district_code ? await deps.prisma.district.findUnique({ where: { code: f.district_code } }) : null
  if (f.district_code && !district) throw new HttpError(404, 'not_found', 'Unknown district')
  const language = f.kind === 'audio' ? f.language! : null
  const districtId = f.kind === 'tiles' ? district!.id : null
  const latest = await deps.prisma.contentPack.aggregate({ where: { kind: f.kind, language, districtId }, _max: { version: true } })
  const version = f.version ?? (latest._max.version ?? 0) + 1
  const exists = await deps.prisma.contentPack.findFirst({ where: { kind: f.kind, language, districtId, version }, select: { id: true } })
  if (exists) throw new HttpError(409, 'conflict', `Version ${version} already exists`)
  const id = randomUUID()
  const filename = id + EXT[f.kind]
  const sha256 = await sha256File(file.path)
  await rename(file.path, join(contentDir(deps), filename))
  try {
    const pack = await deps.prisma.contentPack.create({
      data: { id, kind: f.kind, language, districtId, version, size: file.size, sha256, filename, contentType: TYPE[f.kind], createdAt: deps.clock() },
    })
    return view(pack, f.district_code ?? null)
  } catch (e) {
    await rm(join(contentDir(deps), filename), { force: true })
    // A concurrent upload took the same version (unique kind, language, district, version).
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'conflict', `Version ${version} already exists`)
    throw e
  }
}

export async function listPacks(deps: Deps) {
  const rows = await deps.prisma.contentPack.findMany({ include: { district: { select: { code: true } } }, orderBy: { createdAt: 'desc' } })
  return rows.map((r) => view(r, r.district?.code ?? null))
}

/** Latest audio pack per language the device's facility or district speaks (plus English fallback), and the district's tiles. */
export async function manifest(deps: Deps, device: Device) {
  const home = device.facilityId
    ? await deps.prisma.facility.findUnique({ where: { id: device.facilityId }, select: { languages: true, district: { select: { id: true, code: true, languages: true } } } })
    : null
  const languages = [...new Set([...((home?.languages as string[]) ?? []), ...((home?.district?.languages as string[]) ?? []), 'en'])]
  const audio = await deps.prisma.contentPack.findMany({ where: { kind: 'audio', language: { in: languages } }, orderBy: { version: 'desc' } })
  const tiles = home?.district
    ? await deps.prisma.contentPack.findMany({ where: { kind: 'tiles', districtId: home.district.id }, orderBy: { version: 'desc' }, take: 1 })
    : []
  const latestAudio = languages.map((l) => audio.find((p) => p.language === l)).filter((p): p is (typeof audio)[number] => !!p)
  return { languages, packs: [...latestAudio.map((p) => view(p, null)), ...tiles.map((p) => view(p, home!.district!.code))] }
}

export async function packFile(deps: Deps, id: string | undefined) {
  const pack = id ? await deps.prisma.contentPack.findUnique({ where: { id } }) : null
  if (!pack) throw new HttpError(404, 'not_found', 'Unknown pack')
  return { root: contentDir(deps), filename: pack.filename, contentType: pack.contentType, sha256: pack.sha256 }
}
