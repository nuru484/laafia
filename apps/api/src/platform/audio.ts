import ffmpegPath from 'ffmpeg-static'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { HttpError } from './http/errors.ts'

const execFileAsync = promisify(execFile)

/**
 * Runs the bundled ffmpeg on `audio` through temp files (MP4 often keeps its index at the end, which
 * ffmpeg cannot read from a pipe, and m4a output needs a seekable file). Any decode failure is a 415.
 */
export async function ffmpeg(audio: Buffer, outArgs: string[], outName: string): Promise<Buffer> {
  if (!ffmpegPath) throw new HttpError(500, 'internal', 'ffmpeg is not available')
  const dir = await mkdtemp(join(tmpdir(), 'laafia-audio-'))
  try {
    const input = join(dir, 'in')
    const output = join(dir, outName)
    await writeFile(input, audio)
    await execFileAsync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, ...outArgs, output], { timeout: 30_000 }).catch(() => {
      throw new HttpError(415, 'unsupported_audio', 'Could not decode the audio')
    })
    return await readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 16 kHz mono 16-bit PCM WAV, capped at `maxSeconds` so a long clip still decodes far enough to be measured. */
export const toWav16k = (audio: Buffer, maxSeconds: number) =>
  ffmpeg(audio, ['-t', String(maxSeconds), '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', '-f', 'wav'], 'out.wav')

/** Mono AAC at 32 kbps in an m4a container (what phones play), at most `maxSeconds`, from m4a, mp3, webm/opus, ogg/opus or wav. */
export const toM4a = (audio: Buffer, maxSeconds: number) =>
  ffmpeg(audio, ['-vn', '-t', String(maxSeconds), '-ac', '1', '-ar', '22050', '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart'], 'out.m4a')
