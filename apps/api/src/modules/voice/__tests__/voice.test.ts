import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../../config/env.ts'
import { RATE, resetRateLimits } from '../index.ts'
import { activate, app, bearer, useDb } from '../../../platform/testing/helpers.ts'

useDb()

/** Minimal PCM WAV: 16 kHz mono 16-bit, `seconds` of silence. */
function wav(seconds: number) {
  const data = Math.round(16_000 * 2 * seconds)
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16_000, 24); b.writeUInt32LE(32_000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40)
  return b
}
const post = (jwt: string, audio: Buffer, name = 'reply.wav', lang = 'dag') =>
  request(app).post(`/voice/transcribe?lang=${lang}`).set(bearer(jwt)).attach('audio', audio, name)

afterEach(() => {
  env.KHAYA_API_KEY = undefined
  vi.restoreAllMocks()
  resetRateLimits()
})

describe('voice transcribe (Khaya proxy)', () => {
  it('returns 503 khaya_unconfigured without a key', async () => {
    const jwt = await activate('D001')
    const res = await post(jwt, wav(1))
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('khaya_unconfigured')
  })

  it('forwards WAV to Khaya with the server key and returns only the text', async () => {
    env.KHAYA_API_KEY = 'server-side-secret'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'o be jilli', warnings: [] }), { status: 200 }))
    const jwt = await activate('D001')
    const res = await post(jwt, wav(3))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ text: 'o be jilli', language: 'dag', seconds: 3 })
    expect(JSON.stringify(res.body)).not.toContain('server-side-secret')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://translation-api.ghananlp.org/asr/v3/transcribe?language=dag')
    expect((init!.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('server-side-secret')
  })

  it('rejects long, oversized, non-WAV and unauthenticated uploads, and rate-limits per device', async () => {
    env.KHAYA_API_KEY = 'k'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ text: 'x' })))
    const jwt = await activate('D001')
    expect((await post(jwt, wav(11))).body.code).toBe('audio_too_long')
    expect((await post(jwt, Buffer.alloc(600 * 1024), 'big.wav')).status).toBe(413)
    expect((await post(jwt, Buffer.from('ID3 not a wav file at all, sorry'), 'a.mp3')).status).toBe(415)
    expect((await post(jwt, wav(1), 'a.wav', 'klingon')).status).toBe(400)
    expect((await request(app).post('/voice/transcribe').attach('audio', wav(1), 'a.wav')).status).toBe(401)
    for (let i = 0; i < RATE.perHour; i++) expect((await post(jwt, wav(0.1))).status).toBe(200)
    const limited = await post(jwt, wav(0.1))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
  })
})
