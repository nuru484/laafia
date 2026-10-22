import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { env } from '../../../config/env.ts'
import ffmpegPath from 'ffmpeg-static'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { ADMIN, USERS, activate, app, bearer, signIn, useDb } from '../../../platform/testing/helpers.ts'

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

describe('recording matrix and dashboard clips', () => {
  /** A tone in `format`, made with the bundled ffmpeg, like a browser upload or a MediaRecorder blob. */
  function tone(format: 'mp3' | 'webm' | 'ogg' | 'wav' | 'm4a', seconds = 1) {
    const dir = mkdtempSync(join(tmpdir(), 'laafia-tone-'))
    const out = join(dir, `t.${format}`)
    const codec = { webm: ['-c:a', 'libopus'], ogg: ['-c:a', 'libopus'], mp3: ['-c:a', 'libmp3lame'], m4a: ['-c:a', 'aac'], wav: [] }[format]
    execFileSync(ffmpegPath!, ['-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-ac', '1', ...codec, out])
    return readFileSync(out)
  }
  /** Seconds of audio in a file, from ffmpeg's own report. */
  function seconds(file: Buffer) {
    const dir = mkdtempSync(join(tmpdir(), 'laafia-probe-'))
    const f = join(dir, 'a.m4a')
    writeFileSync(f, file)
    const r = spawnSync(ffmpegPath!, ['-i', f], { encoding: 'utf8' })
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr)!
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  const webClip = (agent: request.Agent, csrf: Record<string, string>, fields: Record<string, string>, audio: Buffer, name: string) => {
    let r = agent.post('/admin/content/clips').set(csrf)
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
    return r.attach('audio', audio, name)
  }
  const download = (agent: request.Agent, url: string) => agent.get(url).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)))
  })

  it('accepts browser formats, converts to m4a and returns the clip', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    const prompts = { m4a: 'yi_feeding', mp3: 'act_go_now', webm: 'num_3', ogg: 'num_4', wav: 'outcome_refer' } as const
    for (const [fmt, prompt] of Object.entries(prompts) as [keyof typeof prompts, string][]) {
      const up = await webClip(agent, csrf, { prompt_id: prompt, lang: 'dag' }, tone(fmt), `rec.${fmt}`)
      expect([fmt, up.status]).toEqual([fmt, 201])
      expect(up.body.clip).toMatchObject({ prompt_id: prompt, lang: 'dag', recorded_by: 'Alhassan Yakubu', url: `/content/clips/${up.body.clip.id}/file` })
    }
    const list = (await agent.get('/admin/content/clips?lang=dag')).body.clips
    expect(list).toHaveLength(5)
    expect(list[0]).toMatchObject({ recorded_by: 'Alhassan Yakubu', device_id: 'web:usr-0001' })
    expect((await agent.get('/admin/content/clips?lang=en')).body.clips).toEqual([])

    // The browser plays it from the admin route; it is always m4a.
    const file = await download(agent, `/admin/content/clips/${list[0].id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('audio/mp4')
    expect((file.body as Buffer).toString('ascii', 4, 8)).toBe('ftyp')
    expect((await agent.get('/admin/audit?target_type=clip')).body.events[0]).toMatchObject({ action: 'clip.upload', actor_name: 'Alhassan Yakubu' })
  })

  it('caps a clip at 20 seconds', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    const up = await webClip(agent, csrf, { prompt_id: 'num_5', lang: 'dag' }, tone('webm', 25), 'long.webm')
    const file = await download(agent, `/admin/content/clips/${up.body.clip.id}/file`)
    expect(seconds(file.body as Buffer)).toBeLessThanOrEqual(20.1)
  })

  it('lists every prompt against each language with who recorded it', async () => {
    const cho = await activate('D001')
    await clip(cho, { prompt_id: 'yi_feeding', lang: 'dag' }, m4a('take'))
    const { agent, csrf } = await signIn(USERS.admin)
    await webClip(agent, csrf, { prompt_id: 'act_go_now', lang: 'dag' }, tone('mp3'), 'rec.mp3')
    const m = (await agent.get('/admin/content/clips/matrix')).body
    expect(m.languages).toEqual(['dag', 'en'])
    expect(m.total).toBeGreaterThan(60)
    expect(m.recorded).toEqual({ dag: 2, en: 0 })
    const byId = Object.fromEntries(m.prompts.map((p: { id: string }) => [p.id, p]))
    expect(byId.yi_feeding.clips.dag).toMatchObject({ recorded_by: 'Abiba Sulemana', url: expect.stringMatching(/^\/content\/clips\//) })
    expect(byId.act_go_now.clips.dag).toMatchObject({ recorded_by: 'Alhassan Yakubu' })
    expect(byId.act_go_now.clips.en).toBeNull()
    expect(byId.num_30).toMatchObject({ group: 'Numbers', text_en: '30' })
  })

  it('refuses other roles, unknown prompts, oversized and non-audio uploads', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await webClip(agent, csrf, { prompt_id: 'yi_feeding', lang: 'dag' }, Buffer.from('not audio at all, honestly'), 'x.mp3')).status).toBe(415)
    expect((await webClip(agent, csrf, { prompt_id: 'no_such_prompt', lang: 'dag' }, tone('wav'), 'x.wav')).status).toBe(400)
    expect((await webClip(agent, csrf, { prompt_id: 'yi_feeding', lang: 'dag' }, Buffer.alloc(2 * 1024 * 1024 + 1), 'x.wav')).status).toBe(413)
    const sup = await signIn(USERS.supervisor)
    expect((await sup.agent.get('/admin/content/clips/matrix')).status).toBe(403)
    expect((await sup.agent.get('/admin/content/clips')).status).toBe(403)
    const staff = await signIn(USERS.hospital)
    expect((await webClip(staff.agent, staff.csrf, { prompt_id: 'yi_feeding', lang: 'dag' }, tone('wav'), 'x.wav')).status).toBe(403)
  })
})
