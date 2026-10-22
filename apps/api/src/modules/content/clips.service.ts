import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { audit } from '../../platform/audit.ts'
import { toM4a } from '../../platform/audio.ts'
import type { Actor, Device } from '../../platform/middleware/auth.ts'
import { allPrompts } from '@laafia/core'
import type { ClipFields } from './content.schemas.ts'
import { contentDir } from './content.service.ts'

/*
 * Prompt audio recorded on phones, one m4a file per clip so low-end phones never unzip.
 * Files live at CONTENT_DIR/clips/<lang>/<prompt_id>-<sha8>.m4a (lang and prompt_id are
 * validated to [a-z0-9_], so they are safe path segments). The newest recording per
 * (lang, prompt_id) replaces the older row and file.
 */

export const MAX_CLIP_BYTES = 300 * 1024
/** Browser uploads and MediaRecorder blobs, before conversion. */
export const MAX_WEB_CLIP_BYTES = 2 * 1024 * 1024
export const MAX_WEB_CLIP_SECONDS = 20
const isMp4 = (buf: Buffer) => buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp'

type Clip = { id: string; lang: string; promptId: string; sha256: string; size: number; filename: string; deviceId: string; recordedAt: number }
const view = (c: Clip) => ({ id: c.id, prompt_id: c.promptId, lang: c.lang, sha256: c.sha256, size: c.size, recorded_at: c.recordedAt, url: `/content/clips/${c.id}/file` })

/** A phone recording: must already be m4a. */
export async function saveClip(deps: Deps, device: Device, audio: Buffer | undefined, f: ClipFields) {
  if (!audio) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "audio"')
  if (!isMp4(audio)) throw new HttpError(415, 'unsupported_audio', 'Clips must be m4a (AAC)')
  return storeClip(deps, device.id, audio, f)
}

/**
 * A dashboard upload or in-browser recording (m4a, mp3, webm/opus, ogg or wav): converted to mono AAC m4a
 * with ffmpeg, so phones always get the same format. Recorded by `web:<user id>`.
 */
export async function saveClipFromWeb(deps: Deps, actor: Actor, audio: Buffer | undefined, f: ClipFields) {
  if (!audio) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "audio"')
  if (!allPrompts().some((p) => p.id === f.prompt_id)) throw new HttpError(400, 'invalid_request', `Unknown prompt_id ${f.prompt_id}`)
  if (!isRecognisedAudio(audio)) throw new HttpError(415, 'unsupported_audio', 'Upload m4a, mp3, webm, ogg or wav audio')
  const m4a = await toM4a(audio, MAX_WEB_CLIP_SECONDS)
  const recordedBy = actor.kind === 'user' ? `web:${actor.user.id}` : 'web:admin'
  const stored = await storeClip(deps, recordedBy, m4a, f)
  await audit(deps, actor, 'clip.upload', { type: 'clip', id: stored.id }, { prompt_id: f.prompt_id, lang: f.lang })
  const row = await deps.prisma.contentClip.findUniqueOrThrow({ where: { id: stored.id } })
  return { ...view(row), recorded_by: actor.kind === 'user' ? actor.user.name : 'Admin token' }
}

/** Container magic numbers: MP4 (ftyp), MP3 (ID3 or a frame sync), WebM/Matroska, Ogg, RIFF WAVE. */
function isRecognisedAudio(b: Buffer) {
  if (b.length < 12) return false
  const ascii = (s: number, e: number) => b.toString('ascii', s, e)
  return ascii(4, 8) === 'ftyp' || ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)
    || b.readUInt32BE(0) === 0x1a45dfa3 || ascii(0, 4) === 'OggS' || (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
}

async function storeClip(deps: Deps, recordedBy: string, audio: Buffer, f: ClipFields) {
  const sha256 = createHash('sha256').update(audio).digest('hex')
  const filename = join('clips', f.lang, `${f.prompt_id}-${sha256.slice(0, 8)}.m4a`)
  await mkdir(join(contentDir(deps), 'clips', f.lang), { recursive: true })
  await writeFile(join(contentDir(deps), filename), audio)
  const old = await deps.prisma.contentClip.findUnique({ where: { lang_promptId: { lang: f.lang, promptId: f.prompt_id } } })
  const data = { id: randomUUID(), sha256, size: audio.length, filename, deviceId: recordedBy, recordedAt: deps.clock() }
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

/** Who recorded each clip, for display: a phone's user name, or a dashboard user's name. */
async function recorderNames(deps: Deps, ids: string[]) {
  const users = ids.filter((i) => i.startsWith('web:')).map((i) => i.slice(4))
  const devices = ids.filter((i) => !i.startsWith('web:'))
  const names = new Map<string, string>()
  for (const u of await deps.prisma.user.findMany({ where: { id: { in: users } }, select: { id: true, name: true } })) names.set(`web:${u.id}`, u.name)
  for (const d of await deps.prisma.device.findMany({ where: { id: { in: devices } }, select: { id: true, userName: true } })) names.set(d.id, d.userName)
  return names
}

export async function adminListClips(deps: Deps, lang?: string) {
  const rows = await deps.prisma.contentClip.findMany({ where: lang ? { lang } : {}, orderBy: { recordedAt: 'desc' } })
  const names = await recorderNames(deps, [...new Set(rows.map((r) => r.deviceId))])
  return rows.map((c) => ({ ...view(c), device_id: c.deviceId, recorded_by: names.get(c.deviceId) ?? c.deviceId }))
}

/**
 * Every prompt against each language: the current clip (with who recorded it and when) or null when missing.
 * Languages default to every district's languages plus English.
 */
export async function clipMatrix(deps: Deps, langs?: string[]) {
  const districts = await deps.prisma.district.findMany({ select: { languages: true } })
  const languages = langs?.length ? langs : [...new Set([...districts.flatMap((d) => (d.languages as string[]) ?? []), 'en'])]
  const rows = await deps.prisma.contentClip.findMany({ where: { lang: { in: languages } } })
  const names = await recorderNames(deps, [...new Set(rows.map((r) => r.deviceId))])
  const byKey = new Map(rows.map((r) => [`${r.lang}:${r.promptId}`, r]))
  const prompts = allPrompts().map((p) => ({
    ...p,
    clips: Object.fromEntries(languages.map((l) => {
      const c = byKey.get(`${l}:${p.id}`)
      return [l, c ? { ...view(c), recorded_by: names.get(c.deviceId) ?? c.deviceId } : null]
    })),
  }))
  const recorded = Object.fromEntries(languages.map((l) => [l, prompts.filter((p) => p.clips[l]).length]))
  return { languages, total: prompts.length, recorded, prompts }
}

export async function clipFile(deps: Deps, id: string) {
  const clip = await deps.prisma.contentClip.findUnique({ where: { id } })
  if (!clip) throw new HttpError(404, 'not_found', 'Unknown clip')
  return { root: contentDir(deps), filename: clip.filename, contentType: 'audio/mp4', sha256: clip.sha256 }
}

export async function deleteClip(deps: Deps, actor: Actor, id: string) {
  const clip = await deps.prisma.contentClip.findUnique({ where: { id } })
  if (!clip) throw new HttpError(404, 'not_found', 'Unknown clip')
  await deps.prisma.contentClip.delete({ where: { id } })
  await rm(join(contentDir(deps), clip.filename), { force: true })
  await audit(deps, actor, 'clip.delete', { type: 'clip', id }, { prompt_id: clip.promptId, lang: clip.lang })
  return { deleted: id }
}
