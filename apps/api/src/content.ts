import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import type { RequestHandler } from 'express'
import multer from 'multer'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, mkdirSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { Device } from './auth.ts'
import { db } from './db.ts'
import { env } from './env.ts'
import { HttpError } from './http.ts'
import { content_packs, districts, facilities } from './schema.ts'

/*
 * Content packs (audio clips per language, PMTiles per district) live on disk
 * under CONTENT_DIR, named by pack id. Downloads go through res.sendFile, which
 * answers Range requests, so a phone on a poor network resumes where it stopped.
 */

const dir = () => resolve(env.CONTENT_DIR)
const EXT = { audio: '.zip', tiles: '.pmtiles' } as const
const TYPE = { audio: 'application/zip', tiles: 'application/vnd.pmtiles' } as const

export const packUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const incoming = join(dir(), '.incoming')
      mkdirSync(incoming, { recursive: true })
      cb(null, incoming)
    },
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 1024 ** 3, files: 1, fields: 10 },
})

const sha256File = (path: string) =>
  new Promise<string>((ok, fail) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', fail)
  })

type PackRow = typeof content_packs.$inferSelect
const view = (p: PackRow, districtCode: string | null) => ({
  id: p.id, kind: p.kind, language: p.language, district_code: districtCode, version: p.version, size: p.size, sha256: p.sha256,
  content_type: p.content_type, url: `/content/packs/${p.id}`, created_at: p.created_at,
})

const UploadFields = z.object({
  kind: z.enum(['audio', 'tiles']),
  language: z.string().regex(/^[a-z]{2,3}$/).optional(),
  district_code: z.string().max(16).optional(),
  version: z.coerce.number().int().positive().optional(),
})

export const uploadPack: RequestHandler = async (req, res) => {
  const file = req.file
  try {
    if (!file) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "file"')
    const f = UploadFields.parse(req.body)
    if (f.kind === 'audio' && !f.language) throw new HttpError(400, 'invalid_request', 'Audio packs need a language')
    if (f.kind === 'tiles' && !f.district_code) throw new HttpError(400, 'invalid_request', 'Tile packs need a district_code')
    const [district] = f.district_code ? await db.select().from(districts).where(eq(districts.code, f.district_code)) : []
    if (f.district_code && !district) throw new HttpError(404, 'not_found', 'Unknown district')
    const language = f.kind === 'audio' ? f.language! : null
    const district_id = f.kind === 'tiles' ? district!.id : null
    const same = and(eq(content_packs.kind, f.kind), language ? eq(content_packs.language, language) : isNull(content_packs.language),
      district_id ? eq(content_packs.district_id, district_id) : isNull(content_packs.district_id))
    const [{ latest }] = (await db.select({ latest: max(content_packs.version) }).from(content_packs).where(same)) as [{ latest: number | null }]
    const version = f.version ?? (latest ?? 0) + 1
    const id = randomUUID()
    const filename = id + EXT[f.kind]
    const sha256 = await sha256File(file.path)
    await rename(file.path, join(dir(), filename))
    const [pack] = await db.insert(content_packs).values({
      id, kind: f.kind, language, district_id, version, size: file.size, sha256, filename, content_type: TYPE[f.kind], created_at: Date.now(),
    }).onConflictDoNothing().returning()
    if (!pack) {
      await rm(join(dir(), filename), { force: true })
      throw new HttpError(409, 'conflict', `Version ${version} already exists`)
    }
    res.status(201).json({ pack: view(pack, f.district_code ?? null) })
  } finally {
    if (file) await rm(file.path, { force: true })
  }
}

export async function listPacks() {
  const rows = await db.select({ p: content_packs, code: districts.code }).from(content_packs).leftJoin(districts, eq(districts.id, content_packs.district_id)).orderBy(desc(content_packs.created_at))
  return rows.map((r) => view(r.p, r.code))
}

/** Latest audio pack per language the device's facility or district speaks (plus English fallback), and the district's tiles. */
export async function manifest(device: Device) {
  const [home] = device.facility_id
    ? await db.select({ f: facilities.languages, d: districts.languages, district_id: districts.id, code: districts.code })
      .from(facilities).leftJoin(districts, eq(districts.id, facilities.district_id)).where(eq(facilities.id, device.facility_id))
    : []
  const languages = [...new Set([...(home?.f ?? []), ...(home?.d ?? []), 'en'])]
  const audio = await db.select().from(content_packs).where(and(eq(content_packs.kind, 'audio'), inArray(content_packs.language, languages))).orderBy(desc(content_packs.version))
  const tiles = home?.district_id
    ? await db.select().from(content_packs).where(and(eq(content_packs.kind, 'tiles'), eq(content_packs.district_id, home.district_id))).orderBy(desc(content_packs.version)).limit(1)
    : []
  const latestAudio = languages.map((l) => audio.find((p) => p.language === l)).filter((p): p is PackRow => !!p)
  return { languages, packs: [...latestAudio.map((p) => view(p, null)), ...tiles.map((p) => view(p, home!.code))] }
}

export const servePack: RequestHandler = async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const [pack] = id.success ? await db.select().from(content_packs).where(eq(content_packs.id, id.data)) : []
  if (!pack) throw new HttpError(404, 'not_found', 'Unknown pack')
  res.setHeader('X-Content-SHA256', pack.sha256)
  await new Promise<void>((ok, fail) =>
    res.sendFile(pack.filename, { root: dir(), headers: { 'Content-Type': pack.content_type }, cacheControl: false }, (err) => {
      if (!err) return ok()
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail(new HttpError(404, 'not_found', 'Pack file missing on disk'))
      // A client that disconnects mid-download is normal on a poor network; it resumes with Range.
      if (res.headersSent) return ok()
      fail(err)
    }),
  )
}
