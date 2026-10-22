import type { RequestHandler, Response } from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { input } from '../../platform/http/validate.ts'
import { deviceOf } from '../../platform/middleware/auth.ts'
import { adminListClips, clipFile, deleteClip, listClips, MAX_CLIP_BYTES, saveClip } from './clips.service.ts'
import { ClipFields, ClipParams, ClipQuery, PackParams, UploadFields } from './content.schemas.ts'
import { addPack, contentDir, listPacks, manifest, packFile } from './content.service.ts'

/** res.sendFile answers Range requests (206), so interrupted downloads resume (the phone fetches tiles in 1 MB ranges). */
async function sendStored(res: Response, f: { root: string; filename: string; contentType: string; sha256: string }) {
  res.setHeader('X-Content-SHA256', f.sha256)
  await new Promise<void>((ok, fail) =>
    res.sendFile(f.filename, { root: f.root, headers: { 'Content-Type': f.contentType }, cacheControl: false }, (err) => {
      if (!err) return ok()
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail(new HttpError(404, 'not_found', 'File missing on disk'))
      // A client that disconnects mid-download is normal on a poor network; it resumes with Range.
      if (res.headersSent) return ok()
      fail(err)
    }),
  )
}

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
  const download: RequestHandler = async (_req, res) => {
    await sendStored(res, await packFile(deps, input(res, 'params', PackParams).id))
  }

  const clipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CLIP_BYTES, files: 1, fields: 5 } }).single('audio')
  const createClip: RequestHandler = async (req, res) => {
    res.status(201).json(await saveClip(deps, deviceOf(res), req.file?.buffer, ClipFields.parse(req.body)))
  }
  const clips: RequestHandler = async (_req, res) => {
    res.json({ clips: await listClips(deps, input(res, 'query', ClipQuery).lang) })
  }
  const clipDownload: RequestHandler = async (_req, res) => {
    await sendStored(res, await clipFile(deps, input(res, 'params', ClipParams).id))
  }
  const adminClips: RequestHandler = async (_req, res) => {
    res.json({ clips: await adminListClips(deps) })
  }
  const removeClip: RequestHandler = async (_req, res) => {
    res.json(await deleteClip(deps, input(res, 'params', ClipParams).id))
  }
  return { upload, create, list, getManifest, download, clipUpload, createClip, clips, clipDownload, adminClips, removeClip }
}
