import { mkdtempSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../../config/env.ts'
import type { Bbox, MapExtractor } from '../../../platform/map-extractor.ts'
import { USERS, activate, app, bearer, deps, prisma, signIn, useDb } from '../../../platform/testing/helpers.ts'
import { failInterruptedBuilds } from '../maps.service.ts'

useDb()
const real = deps.maps
let calls: Bbox[] = []
/** Stands in for the pmtiles CLI: writes a small file, or fails, after `gate` resolves. */
function fakeExtractor(opts: { fail?: string; gate?: Promise<void> } = {}): MapExtractor {
  return {
    async extract(bbox, out) {
      calls.push(bbox)
      await opts.gate
      if (opts.fail) throw new Error(opts.fail)
      await writeFile(out, `PMTiles ${bbox.join(',')}`)
      return { source: 'https://build.protomaps.com/20261021.pmtiles' }
    },
  }
}
beforeEach(() => {
  env.CONTENT_DIR = mkdtempSync(join(tmpdir(), 'laafia-content-'))
  calls = []
  deps.maps = fakeExtractor()
})
afterEach(() => {
  deps.maps = real
})

const SAV_BOX: Bbox = [-0.9, 9.5, -0.7, 9.7]
const settled = async (agent: request.Agent) => {
  let body: { build: { status: string } | null } = { build: null }
  await vi.waitFor(async () => {
    body = (await agent.get('/admin/maps/SAV')).body
    expect(body.build?.status).not.toBe('running')
  })
  return body as { build: { status: string; error: string | null; pack_version: number | null; bbox: Bbox } }
}

describe('district map builds', () => {
  it('suggests an area around the district facilities and households with GPS', async () => {
    const { agent } = await signIn(USERS.admin)
    const res = await agent.get('/admin/maps/SAV')
    expect(res.status).toBe(200)
    const pts = await prisma.facility.findMany({ where: { districtId: 'dist-sav' }, select: { lat: true, lng: true } })
    const [w, s, e, n] = res.body.suggested.bbox as Bbox
    for (const p of pts) {
      expect(p.lng).toBeGreaterThan(w)
      expect(p.lng).toBeLessThan(e)
      expect(p.lat).toBeGreaterThan(s)
      expect(p.lat).toBeLessThan(n)
    }
    expect(res.body.suggested.facilities).toBe(pts.length)
    expect(res.body.suggested.households).toBeGreaterThan(0)
    expect(res.body).toMatchObject({ district_code: 'SAV', last_bbox: null, build: null })
  })

  it('cuts the map in the background and publishes it as the next tiles version for the phones', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    const start = await agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox: SAV_BOX })
    expect(start.status).toBe(202)
    expect(start.body.build).toMatchObject({ status: 'running', bbox: SAV_BOX })

    const done = await settled(agent)
    expect(done.build).toMatchObject({ status: 'done', error: null, pack_version: 1 })
    expect(calls).toEqual([SAV_BOX])
    expect((await agent.get('/admin/maps/SAV')).body.last_bbox).toEqual(SAV_BOX)

    const m = await request(app).get('/content/manifest').set(bearer(await activate('D001')))
    expect(m.body.packs).toMatchObject([{ kind: 'tiles', district_code: 'SAV', version: 1 }])
    const audit = await prisma.auditEvent.findMany({ where: { action: 'map.build' } })
    expect(audit).toHaveLength(1)
  })

  it('runs one build per district at a time', async () => {
    let open!: () => void
    deps.maps = fakeExtractor({ gate: new Promise((ok) => (open = ok)) })
    const { agent, csrf } = await signIn(USERS.admin)
    const [a, b] = await Promise.all([
      agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox: SAV_BOX }),
      agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox: SAV_BOX }),
    ])
    expect([a.status, b.status].sort()).toEqual([202, 409])
    expect([a.body.code, b.body.code]).toContain('map_build_running')
    open()
    expect((await settled(agent)).build.status).toBe('done')
    expect((await agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox: SAV_BOX })).status).toBe(202)
  })

  it('records a failed cut without publishing anything', async () => {
    deps.maps = fakeExtractor({ fail: 'pmtiles: fetch failed' })
    const { agent, csrf } = await signIn(USERS.admin)
    await agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox: SAV_BOX })
    expect((await settled(agent)).build).toMatchObject({ status: 'failed', error: 'pmtiles: fetch failed', pack_version: null })
    expect(await prisma.contentPack.count()).toBe(0)
  })

  it('rejects inverted, out-of-range and oversized areas', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    for (const bbox of [[-0.7, 9.5, -0.9, 9.7], [-0.9, 9.7, -0.7, 9.5], [-0.9, 9.5, 200, 9.7], [-2, 9, 0, 11], [1, 2, 3]]) {
      expect((await agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox })).status).toBe(400)
    }
    expect(calls).toEqual([])
  })

  it('keeps maps to the admin district and away from other roles', async () => {
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await agent.get('/admin/maps/TML')).status).toBe(403)
    expect((await agent.post('/admin/maps/TML/builds').set(csrf).send({ bbox: SAV_BOX })).status).toBe(403)
    expect((await agent.get('/admin/maps/NOPE')).status).toBe(404)
    const sup = await signIn(USERS.supervisor)
    expect((await sup.agent.get('/admin/maps/SAV')).status).toBe(403)
    expect((await sup.agent.post('/admin/maps/SAV/builds').set(sup.csrf).send({ bbox: SAV_BOX })).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('marks builds a restart interrupted as failed so the district can build again', async () => {
    await prisma.mapBuild.create({ data: { id: 'b1', districtId: 'dist-sav', bbox: SAV_BOX, status: 'running', startedAt: 1n } })
    await failInterruptedBuilds(deps)
    const { agent, csrf } = await signIn(USERS.admin)
    expect((await agent.get('/admin/maps/SAV')).body.build).toMatchObject({ status: 'failed', error: 'Interrupted by a server restart' })
    expect((await agent.post('/admin/maps/SAV/builds').set(csrf).send({ bbox: SAV_BOX })).status).toBe(202)
  })
})
