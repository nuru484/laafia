import type { RequestHandler } from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { input } from '../../platform/http/validate.ts'
import { deviceOf } from '../../platform/middleware/auth.ts'
import { PackParams, UploadFields } from './content.schemas.ts'
import { addPack, contentDir, listPacks, manifest, packFile } from './content.service.ts'

export function createContentController(deps: Deps) {
  /** Uploads stream to CONTENT_DIR/.incoming first, then are hashed and renamed by the service. */
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const incoming = join(contentDir(deps), '.incoming')
        mkdirSync(incoming, { recursive: true })
        cb(null, incoming)
      },
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: 1024 ** 3, files: 1, fields: 10 },
  }).single('file')

  const create: RequestHandler = async (req, res) => {
    const file = req.file
    try {
      if (!file) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "file"')
      res.status(201).json({ pack: await addPack(deps, file, UploadFields.parse(req.body)) })
    } finally {
      if (file) await rm(file.path, { force: true })
    }
  }
  const list: RequestHandler = async (_req, res) => {
    res.json({ packs: await listPacks(deps) })
  }
  const getManifest: RequestHandler = async (_req, res) => {
    res.json(await manifest(deps, deviceOf(res)))
  }
  /** res.sendFile answers Range requests (206), so interrupted downloads resume. */
  const download: RequestHandler = async (_req, res) => {
    const pack = await packFile(deps, input(res, 'params', PackParams).id)
    res.setHeader('X-Content-SHA256', pack.sha256)
    await new Promise<void>((ok, fail) =>
      res.sendFile(pack.filename, { root: pack.root, headers: { 'Content-Type': pack.contentType }, cacheControl: false }, (err) => {
        if (!err) return ok()
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail(new HttpError(404, 'not_found', 'Pack file missing on disk'))
        // A client that disconnects mid-download is normal on a poor network; it resumes with Range.
        if (res.headersSent) return ok()
        fail(err)
      }),
    )
  }
  return { upload, create, list, getManifest, download }
}
