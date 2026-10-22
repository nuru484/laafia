import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
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

const upload = (fields: Record<string, string>, bytes: Buffer, name: string) => {
  let r = request(app).post('/admin/content/packs').set(ADMIN)
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v)
  return r.attach('file', bytes, name)
}
type Pack = { id: string; kind: string; language: string | null; district_code: string | null; version: number; size: number; sha256: string; url: string }

describe('content packs', () => {
  it('uploads with a computed sha256, lists what the device needs, and serves byte ranges', async () => {
    const dag1 = Buffer.from('dagbani audio pack v1')
    const dag2 = Buffer.from('dagbani audio pack v2, more clips')
    const tiles = Buffer.from('PMTiles savelugu district extract')
    const up = await upload({ kind: 'audio', language: 'dag' }, dag1, 'dag.zip')
    expect(up.status).toBe(201)
    expect(up.body.pack).toMatchObject({ kind: 'audio', language: 'dag', version: 1, size: dag1.length, sha256: createHash('sha256').update(dag1).digest('hex') })
    await upload({ kind: 'audio', language: 'dag' }, dag2, 'dag.zip')
    await upload({ kind: 'audio', language: 'twi' }, Buffer.from('twi'), 'twi.zip')
    await upload({ kind: 'tiles', district_code: 'SAV' }, tiles, 'sav.pmtiles')
    await upload({ kind: 'tiles', district_code: 'TML' }, Buffer.from('tamale'), 'tml.pmtiles')
    expect((await upload({ kind: 'tiles' }, tiles, 'x.pmtiles')).status).toBe(400)

    const jwt = await activate('D001')
    const m = await request(app).get('/content/manifest').set(bearer(jwt))
    expect(m.status).toBe(200)
    const packs = m.body.packs as Pack[]
    expect(packs.map((p) => `${p.kind}:${p.language ?? p.district_code}:v${p.version}`).sort()).toEqual(['audio:dag:v2', 'tiles:SAV:v1'])

    const dag = packs.find((p) => p.kind === 'audio')!
    const full = await request(app).get(dag.url).set(bearer(jwt)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(full.status).toBe(200)
    expect(createHash('sha256').update(full.body as Buffer).digest('hex')).toBe(dag.sha256)
    const part = await request(app).get(dag.url).set(bearer(jwt)).set('Range', 'bytes=0-7')
    expect(part.status).toBe(206)
    expect(part.headers['content-range']).toBe(`bytes 0-7/${dag2.length}`)

    expect((await request(app).get(dag.url)).status).toBe(401)
    expect((await request(app).get('/content/packs/nope').set(bearer(jwt))).status).toBe(404)
  })
})
