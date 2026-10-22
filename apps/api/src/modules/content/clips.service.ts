import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Device } from '../../platform/middleware/auth.ts'
import type { ClipFields } from './content.schemas.ts'
import { contentDir } from './content.service.ts'

/*
 * Prompt audio recorded on phones, one m4a file per clip so low-end phones never unzip.
 * Files live at CONTENT_DIR/clips/<lang>/<prompt_id>-<sha8>.m4a (lang and prompt_id are
 * validated to [a-z0-9_], so they are safe path segments). The newest recording per
 * (lang, prompt_id) replaces the older row and file.
 */

export const MAX_CLIP_BYTES = 300 * 1024
const isMp4 = (buf: Buffer) => buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp'

type Clip = { id: string; lang: string; promptId: string; sha256: string; size: number; filename: string; deviceId: string; recordedAt: number }
const view = (c: Clip) => ({ id: c.id, prompt_id: c.promptId, lang: c.lang, sha256: c.sha256, size: c.size, recorded_at: c.recordedAt, url: `/content/clips/${c.id}/file` })

export async function saveClip(deps: Deps, device: Device, audio: Buffer | undefined, f: ClipFields) {
  if (!audio) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "audio"')
  if (!isMp4(audio)) throw new HttpError(415, 'unsupported_audio', 'Clips must be m4a (AAC)')
  const sha256 = createHash('sha256').update(audio).digest('hex')
  const filename = join('clips', f.lang, `${f.prompt_id}-${sha256.slice(0, 8)}.m4a`)
  await mkdir(join(contentDir(deps), 'clips', f.lang), { recursive: true })
  await writeFile(join(contentDir(deps), filename), audio)
  const old = await deps.prisma.contentClip.findUnique({ where: { lang_promptId: { lang: f.lang, promptId: f.prompt_id } } })
  const data = { id: randomUUID(), sha256, size: audio.length, filename, deviceId: device.id, recordedAt: deps.clock() }
  const clip = await deps.prisma.contentClip.upsert({
    where: { lang_promptId: { lang: f.lang, promptId: f.prompt_id } },
    create: { ...data, lang: f.lang, promptId: f.prompt_id },
    update: data,
  })
  if (old && old.filename !== filename) await rm(join(contentDir(deps), old.filename), { force: true })
  return { id: clip.id, sha256, size: clip.size }
}

export async function listClips(deps: Deps, lang?: string) {
  const rows = await deps.prisma.contentClip.findMany({ where: lang ? { lang } : {}, orderBy: [{ lang: 'asc' }, { promptId: 'asc' }] })
  return rows.map(view)
}

export async function adminListClips(deps: Deps) {
  const rows = await deps.prisma.contentClip.findMany({ orderBy: { recordedAt: 'desc' } })
  return rows.map((c) => ({ ...view(c), device_id: c.deviceId }))
}

export async function clipFile(deps: Deps, id: string) {
  const clip = await deps.prisma.contentClip.findUnique({ where: { id } })
  if (!clip) throw new HttpError(404, 'not_found', 'Unknown clip')
  return { root: contentDir(deps), filename: clip.filename, contentType: 'audio/mp4', sha256: clip.sha256 }
}

export async function deleteClip(deps: Deps, id: string) {
  const clip = await deps.prisma.contentClip.findUnique({ where: { id } })
  if (!clip) throw new HttpError(404, 'not_found', 'Unknown clip')
  await deps.prisma.contentClip.delete({ where: { id } })
  await rm(join(contentDir(deps), clip.filename), { force: true })
  return { deleted: id }
}
