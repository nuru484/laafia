import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Speech from 'expo-speech'
import { Directory, File, Paths } from 'expo-file-system'
import type { Db } from './db/db'

export const LANGS: { code: string; name: string }[] = [
  { code: 'dag', name: 'Dagbani' },
  { code: 'en', name: 'English' },
]

let player: AudioPlayer | null = null

export function clipsDir(lang: string): Directory {
  const dir = new Directory(Paths.document, 'audio', lang)
  if (!dir.exists) dir.create({ intermediates: true })
  return dir
}

export async function clipUri(db: Db, promptId: string, lang: string): Promise<string | null> {
  const row = await db.get<{ uri: string }>('SELECT uri FROM audio_clips WHERE prompt_id = ? AND lang = ?', [promptId, lang])
  if (!row) return null
  return new File(row.uri).exists ? row.uri : null
}

export function stop() {
  Speech.stop()
  player?.pause()
}

/**
 * Speak a prompt in the family's language: the recorded clip for `lang`, then
 * the English clip, then the phone's English voice so a missing clip never
 * blocks the visit. Returns which one played, so the UI can flag a gap.
 */
export async function speak(db: Db, promptId: string, textEn: string, lang: string): Promise<'clip' | 'english_clip' | 'tts'> {
  stop()
  await setAudioModeAsync({ playsInSilentMode: true })
  const uri = (await clipUri(db, promptId, lang)) ?? (lang !== 'en' ? await clipUri(db, promptId, 'en') : null)
  if (uri) {
    if (!player) player = createAudioPlayer(uri)
    else player.replace(uri)
    await player.seekTo(0)
    player.play()
    return (await clipUri(db, promptId, lang)) ? 'clip' : 'english_clip'
  }
  Speech.speak(textEn, { language: 'en-GB', rate: 0.9 })
  return 'tts'
}

export async function saveClip(db: Db, promptId: string, lang: string, recordedUri: string): Promise<void> {
  const target = new File(clipsDir(lang), `${promptId}.m4a`)
  if (target.exists) target.delete()
  await new File(recordedUri).move(target)
  await db.run("INSERT INTO audio_clips (prompt_id, lang, uri, recorded_at, uploaded_sha, source) VALUES (?,?,?,?,NULL,'local') ON CONFLICT(prompt_id, lang) DO UPDATE SET uri = excluded.uri, recorded_at = excluded.recorded_at, uploaded_sha = NULL, source = 'local'",
    [promptId, lang, target.uri, Date.now()])
}
