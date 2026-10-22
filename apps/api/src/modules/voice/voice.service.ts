import { toWav16k } from '../../platform/audio.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { fixedWindow } from '../../platform/middleware/rate-limit.ts'

/*
 * Khaya (GhanaNLP) speech-to-text proxy (spec 8, "transcribe reply"). The API
 * key stays on the server. Khaya ASR v3: POST {base}/asr/v3/transcribe?language=<iso639-3>
 * with the raw WAV bytes and an Ocp-Apim-Subscription-Key header; it answers
 * { text, warnings } (v1 answered a bare string, accepted too). Khaya wants WAV
 * PCM mono, 16 kHz recommended. Phones record m4a/AAC, which is decoded to that
 * here; the 10 s limit is checked on the decoded WAV header. WAV input is sent as-is.
 */

export const MAX_AUDIO_BYTES = 500 * 1024
export const MAX_AUDIO_SECONDS = 10
export const RATE = { perHour: 20 }

/** Seconds of audio in a PCM WAV buffer, or null if it is not a WAV file. */
export function wavSeconds(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let byteRate = 0
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ' && off + 20 <= buf.length) byteRate = buf.readUInt32LE(off + 16)
    if (id === 'data') return byteRate ? Math.min(size, buf.length - off - 8) / byteRate : null
    off += 8 + size + (size % 2)
  }
  return null
}

/** MP4 container (m4a/AAC from Android's recorder): an `ftyp` box at offset 4. */
export const isMp4 = (buf: Buffer) => buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp'

const limiter = fixedWindow(RATE.perHour, 3_600_000, `At most ${RATE.perHour} transcriptions per hour`)
export const resetRateLimits = () => limiter.reset()

export function assertConfigured(deps: Deps) {
  if (!deps.env.KHAYA_API_KEY) throw new HttpError(503, 'khaya_unconfigured', 'Transcription is not configured on this server')
}

export async function transcribe(deps: Deps, deviceId: string, audio: Buffer | undefined, lang: string) {
  assertConfigured(deps)
  if (!audio) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "audio"')
  if (isMp4(audio)) audio = await toWav16k(audio, MAX_AUDIO_SECONDS + 2)
  const seconds = wavSeconds(audio)
  if (seconds === null) throw new HttpError(415, 'unsupported_audio', 'Audio must be m4a (AAC) or WAV (PCM)')
  if (seconds > MAX_AUDIO_SECONDS + 0.5) throw new HttpError(400, 'audio_too_long', `At most ${MAX_AUDIO_SECONDS} s of audio`)
  limiter.hit(deviceId)

  const r = await fetch(`${deps.env.KHAYA_BASE_URL}/asr/v3/transcribe?language=${lang}`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': deps.env.KHAYA_API_KEY!, 'Content-Type': 'audio/wav' },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!r?.ok) {
    deps.logger.warn('khaya_failed', { status: r?.status ?? 'network', device: deviceId })
    throw new HttpError(502, 'khaya_error', 'Transcription service failed')
  }
  const body = (await r.json().catch(() => null)) as { text?: string } | string | null
  const text = typeof body === 'string' ? body : body?.text
  if (typeof text !== 'string') throw new HttpError(502, 'khaya_error', 'Unexpected transcription response')
  return { text, language: lang, seconds: Math.round(seconds * 10) / 10 }
}
