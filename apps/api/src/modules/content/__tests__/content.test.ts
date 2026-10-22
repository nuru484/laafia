import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { env } from '../../../config/env.ts'
import { ADMIN, activate, app, bearer, useDb } from '../../../platform/testing/helpers.ts'

useDb()
beforeEach(() => {
  env.CONTENT_DIR = mkdtempSync(join(tmpdir(), 'laafia-content-'))
})

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const binary = (r: request.Test) => r.buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)))
})
const upload = (fields: Record<string, string>, bytes: Buffer, name: string) => {
  let r = request(app).post('/admin/content/packs').set(ADMIN)
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
  return r.attach('file', bytes, name)
}
/** Smallest buffer that passes the MP4 (m4a) magic check: an ftyp box. */
const m4a = (text: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypM4A \0\0\0\0M4A mp42'), Buffer.from(text)])
const clip = (jwt: string, fields: Record<string, string>, audio: Buffer) => {
  let r = request(app).post('/content/clips').set(bearer(jwt))
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
  return r.attach('audio', audio, 'clip.m4a')
}
type Pack = { id: string; kind: string; district_code: string | null; version: number; sha256: string; url: string }

describe('map tile packs', () => {
  it('uploads with a computed sha256, lists the district tiles, and serves byte ranges', async () => {
    const tiles1 = Buffer.from('PMTiles savelugu district extract v1')
    const tiles2 = Buffer.from('PMTiles savelugu district extract v2, more roads')
    const up = await upload({ kind: 'tiles', district_code: 'SAV' }, tiles1, 'sav.pmtiles')
    expect(up.status).toBe(201)
    expect(up.body.pack).toMatchObject({ kind: 'tiles', district_code: 'SAV', version: 1, size: tiles1.length, sha256: sha(tiles1) })
    await upload({ kind: 'tiles', district_code: 'SAV' }, tiles2, 'sav.pmtiles')
    await upload({ kind: 'tiles', district_code: 'TML' }, Buffer.from('tamale'), 'tml.pmtiles')
    expect((await upload({ kind: 'tiles' }, tiles1, 'x.pmtiles')).status).toBe(400)
    expect((await upload({ kind: 'audio', language: 'dag' }, tiles1, 'dag.zip')).status).toBe(400) // audio travels as clips

    const jwt = await activate('D001')
    const m = await request(app).get('/content/manifest').set(bearer(jwt))
    expect(m.status).toBe(200)
    const packs = m.body.packs as Pack[]
    expect(packs.map((p) => `${p.kind}:${p.district_code}:v${p.version}`)).toEqual(['tiles:SAV:v2'])
    expect(m.body.languages).toEqual(['dag', 'en'])

    const tiles = packs[0]!
    const full = await binary(request(app).get(tiles.url).set(bearer(jwt)))
    expect(full.status).toBe(200)
    expect(sha(full.body as Buffer)).toBe(tiles.sha256)
    const part = await request(app).get(tiles.url).set(bearer(jwt)).set('Range', 'bytes=0-7')
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 0-7/${tiles2.length}`)

    expect((await request(app).get(tiles.url)).status).toBe(401)
    expect((await request(app).get('/content/packs/nope').set(bearer(jwt))).status).toBe(404)
  })
})

describe('audio clips', () => {
  it('stores clips recorded on phones, newest per prompt, and serves them', async () => {
    const cho = await activate('D001')
    const first = m4a('first take')
    const up = await clip(cho, { prompt_id: 'yi_feeding', lang: 'dag' }, first)
    expect(up.status).toBe(201)
    expect(up.body).toEqual({ id: expect.any(String), sha256: sha(first), size: first.length })
    expect(existsSync(join(env.CONTENT_DIR, 'clips', 'dag', `yi_feeding-${sha(first).slice(0, 8)}.m4a`))).toBe(true)

    const second = m4a('second, better take')
    const again = await clip(cho, { prompt_id: 'yi_feeding', lang: 'dag' }, second)
    await clip(cho, { prompt_id: 'act_go_now', lang: 'dag' }, m4a('go now'))
    await clip(cho, { prompt_id: 'yi_feeding', lang: 'en' }, m4a('english'))

    const list = await request(app).get('/content/clips?lang=dag').set(bearer(cho))
    expect(list.status).toBe(200)
    expect(list.body.clips.map((c: { prompt_id: string }) => c.prompt_id).sort()).toEqual(['act_go_now', 'yi_feeding'])
    const feeding = list.body.clips.find((c: { prompt_id: string }) => c.prompt_id === 'yi_feeding')
    expect(feeding).toMatchObject({ id: again.body.id, lang: 'dag', sha256: sha(second), size: second.length, recorded_at: expect.any(Number), url: `/content/clips/${again.body.id}/file` })
    // The older take's file is gone.
    expect(existsSync(join(env.CONTENT_DIR, 'clips', 'dag', `yi_feeding-${sha(first).slice(0, 8)}.m4a`))).toBe(false)

    const file = await binary(request(app).get(feeding.url).set(bearer(cho)))
    expect(sha(file.body as Buffer)).toBe(sha(second))
    expect((await request(app).get(feeding.url).set(bearer(cho)).set('Range', 'bytes=0-3')).status).toBe(206)
  })

  it('validates the upload and who may record', async () => {
    const cho = await activate('D001')
    expect((await clip(cho, { prompt_id: 'Bad-Id', lang: 'dag' }, m4a('x'))).status).toBe(400)
    expect((await clip(cho, { prompt_id: 'ok', lang: 'dagbani' }, m4a('x'))).status).toBe(400)
    expect((await clip(cho, { prompt_id: 'ok', lang: 'dag' }, Buffer.from('RIFF....WAVEnot m4a'))).status).toBe(415)
    expect((await clip(cho, { prompt_id: 'ok', lang: 'dag' }, Buffer.alloc(301 * 1024))).status).toBe(413)
    const vol = await activate('V001', '0240000002')
    expect((await clip(vol, { prompt_id: 'ok', lang: 'dag' }, m4a('x'))).status).toBe(403)
    const fac = await activate('F001', '0200000001')
    expect((await clip(fac, { prompt_id: 'ok', lang: 'dag' }, m4a('x'))).status).toBe(201)
  })

  it('lets the admin list and delete clips', async () => {
    const cho = await activate('D001')
    const up = await clip(cho, { prompt_id: 'yi_feeding', lang: 'dag' }, m4a('x'))
    const list = await request(app).get('/admin/content/clips').set(ADMIN)
    expect(list.body.clips).toHaveLength(1)
    expect(list.body.clips[0]).toMatchObject({ id: up.body.id, prompt_id: 'yi_feeding', device_id: 'D001' })
    expect((await request(app).delete(`/admin/content/clips/${up.body.id}`).set(ADMIN)).status).toBe(200)
    expect((await request(app).get('/content/clips?lang=dag').set(bearer(cho))).body.clips).toEqual([])
    expect((await request(app).get(`/content/clips/${up.body.id}/file`).set(bearer(cho))).status).toBe(404)
    expect((await request(app).delete(`/admin/content/clips/${up.body.id}`).set(ADMIN)).status).toBe(404)
  })
})
