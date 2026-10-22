import { Directory, File, FileMode, Paths } from 'expo-file-system'
import { API_URL } from './api'
import type { Api } from './sync'
import type { Env } from './relay'
import { clipsDir } from './audio'

/*
 * Content the phone needs beyond the register (docs/API.md /content):
 * the district map tiles as one PMTiles file, downloaded in 1 MB Range chunks
 * so a dropped connection resumes, and the prompt clips for the catchment's
 * languages, uploaded by whoever recorded them and downloaded one by one.
 */

const CHUNK = 1024 * 1024

type Pack = { id: string; kind: string; language: string | null; district_code: string | null; version: number; size: number; sha256: string; url: string }

function mapsDir(): Directory {
  const d = new Directory(Paths.document, 'maps')
  if (!d.exists) d.create({ intermediates: true })
  return d
}

export function tilesFile(): File | null {
  const f = new File(mapsDir(), 'district.pmtiles')
  return f.exists ? f : null
}

async function meta(env: Env, key: string): Promise<string | undefined> {
  return (await env.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]))?.value
}
async function setMeta(env: Env, key: string, value: string) {
  await env.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value])
}

/** Resumable download: appends Range chunks to a .part file, verifies sha256, then swaps it in. */
async function download(url: string, jwt: string, target: File, size: number, sha256: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const part = new File(target.parentDirectory, `${target.name}.part`)
  if (!part.exists) part.create()
  let offset = part.size ?? 0
  if (offset > size) { part.delete(); part.create(); offset = 0 }
  const handle = part.open(FileMode.Append)
  try {
    while (offset < size) {
      const end = Math.min(offset + CHUNK, size) - 1
      const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}`, Range: `bytes=${offset}-${end}` } })
      if (res.status !== 206 && res.status !== 200) throw new Error(`download failed: HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      // A server that ignored Range sent the whole file; keep only what is missing.
      const chunk = res.status === 200 ? bytes.subarray(offset) : bytes
      await handle.writeBytes(chunk)
      offset += chunk.length
      onProgress?.(offset, size)
      if (res.status === 200) break
    }
  } finally {
    handle.close()
  }
  const digest = (await part.digest('SHA-256')).toLowerCase()
  if (digest !== sha256.toLowerCase()) {
    part.delete()
    throw new Error('Downloaded map failed its checksum; it will download again')
  }
  if (target.exists) target.delete()
  part.move(target)
}

export async function syncTiles(env: Env, api: Api, jwt: string, onProgress?: (done: number, total: number) => void): Promise<'current' | 'updated' | 'none'> {
  const manifest = (await api.request('GET', '/content/manifest')) as { packs: Pack[] }
  const pack = manifest.packs.filter((p) => p.kind === 'tiles').sort((a, b) => b.version - a.version)[0]
  if (!pack) return 'none'
  if ((await meta(env, 'tiles_version')) === `${pack.id}:${pack.version}` && tilesFile()) return 'current'
  await download(API_URL + pack.url, jwt, new File(mapsDir(), 'district.pmtiles'), pack.size, pack.sha256, onProgress)
  await setMeta(env, 'tiles_version', `${pack.id}:${pack.version}`)
  return 'updated'
}

type Clip = { id: string; prompt_id: string; lang: string; sha256: string; size: number; recorded_at: number; url: string }

/** Upload clips recorded on this phone, then fetch any newer clips for the catchment's languages. */
export async function syncClips(env: Env, api: Api & { upload: (path: string, form: FormData) => Promise<any> }, jwt: string, langs: string[]): Promise<{ uploaded: number; downloaded: number }> {
  const { db } = env
  let uploaded = 0
  const pending = await db.all<{ prompt_id: string; lang: string; uri: string }>('SELECT prompt_id, lang, uri FROM audio_clips WHERE uploaded_sha IS NULL AND source = ?', ['local'])
  for (const c of pending) {
    const form = new FormData()
    form.append('prompt_id', c.prompt_id)
    form.append('lang', c.lang)
    form.append('audio', { uri: c.uri, name: `${c.prompt_id}.m4a`, type: 'audio/mp4' } as unknown as Blob)
    const res = await api.upload('/content/clips', form)
    await db.run('UPDATE audio_clips SET uploaded_sha = ? WHERE prompt_id = ? AND lang = ?', [res.sha256, c.prompt_id, c.lang])
    uploaded++
  }
  let downloaded = 0
  for (const lang of langs) {
    const { clips } = (await api.request('GET', `/content/clips?lang=${encodeURIComponent(lang)}`)) as { clips: Clip[] }
    for (const clip of clips) {
      const local = await db.get<{ uploaded_sha: string | null; recorded_at: number }>('SELECT uploaded_sha, recorded_at FROM audio_clips WHERE prompt_id = ? AND lang = ?', [clip.prompt_id, lang])
      if (local && (local.uploaded_sha === clip.sha256 || local.recorded_at >= clip.recorded_at)) continue
      const target = new File(clipsDir(lang), `${clip.prompt_id}.m4a`)
      await download(API_URL + clip.url, jwt, target, clip.size, clip.sha256)
      await db.run(
        "INSERT INTO audio_clips (prompt_id, lang, uri, recorded_at, uploaded_sha, source) VALUES (?,?,?,?,?,'server') ON CONFLICT(prompt_id, lang) DO UPDATE SET uri = excluded.uri, recorded_at = excluded.recorded_at, uploaded_sha = excluded.uploaded_sha, source = 'server'",
        [clip.prompt_id, lang, target.uri, clip.recorded_at, clip.sha256])
      downloaded++
    }
  }
  return { uploaded, downloaded }
}
