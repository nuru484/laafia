import { encode } from '@laafia/core'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { ADMIN, KEYS, activate, app, bearer, lfr, sms, useDb } from '../../../platform/testing/helpers.ts'

useDb()

/** Reads SSE frames until `until` matches or 3 s pass. */
async function readUntil(body: ReadableStream<Uint8Array>, until: RegExp) {
  const reader = body.getReader()
  let text = ''
  const deadline = Date.now() + 3_000
  while (!until.test(text) && Date.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
  }
  return text
}

describe('SSE inbox', () => {
  it('uses a single-use ticket scoped to one facility, never a query token', async () => {
    const jwt = await activate('F003', '0200000003')
    expect((await request(app).get('/events?facility=SAV-HOSP-01&token=test-admin-token')).status).toBe(401)
    const t = await request(app).post('/events/ticket').set(bearer(jwt)).send({ facility: 'SAV-HOSP-01' })
    expect(t.status).toBe(200)
    expect((await request(app).post('/events/ticket').set(bearer(jwt)).send({ facility: 'PTA-HC-01' })).status).toBe(403)

    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    try {
      const ctl = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/events?ticket=${t.body.ticket}`, { signal: ctl.signal })
      expect(res.status).toBe(200)
      expect(await readUntil(res.body!, /event: ready/)).toContain('event: ready')
      ctl.abort()
      expect((await fetch(`http://127.0.0.1:${port}/events?ticket=${t.body.ticket}`)).status).toBe(401)
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })

  it('publishes a referral to its destination facility as it arrives', async () => {
    const t = await request(app).post('/events/ticket').set(ADMIN).send({ facility: 'SAV-HOSP-01' })
    const server = app.listen(0)
    const port = (server.address() as { port: number }).port
    try {
      const ctl = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}/events?ticket=${t.body.ticket}`, { signal: ctl.signal })
      const frames = readUntil(res.body!, /event: referral/)
      await new Promise((r) => setTimeout(r, 50))
      await sms(encode(lfr, KEYS.D001!))
      const text = await frames
      ctl.abort()
      const data = JSON.parse(text.split('event: referral\ndata: ')[1]!.split('\n')[0]!)
      // Savelugu Hospital has a phone in facility mode, so the server does not acknowledge for it.
      expect(data).toMatchObject({ origin_device_id: 'D001', destination_facility_id: 'fac-0003', status: 'created', delivered_via: 'sms', events: [] })
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })
})
