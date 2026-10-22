import { eq, sql } from 'drizzle-orm'
import express from 'express'
import { randomBytes, randomInt } from 'node:crypto'
import { z } from 'zod'
import { activate, ActivateBody, actorOf, auth, deviceOf, keysFor, refresh } from './auth.ts'
import { db, write } from './db.ts'
import { errorHandler, HttpError } from './http.ts'
import { bus, facilityByCode, handleInboundSms, listReferrals, setStatus, visibleTo, WEB_STATUSES, type ReferralView } from './referrals.ts'
import { activation_codes, devices } from './schema.ts'
import { pull, PullQuery, push, PushBody } from './sync.ts'

const FacilityQuery = z.object({ facility: z.string().min(1).max(32) })

/** A facility device may only act for its own facility; the admin token may act for any. */
async function facilityFor(res: express.Response, code: string) {
  const f = await facilityByCode(code)
  const actor = actorOf(res)
  if (actor.kind === 'device' && actor.device.facility_id !== f.id) throw new HttpError(403, 'forbidden', 'Not your facility')
  return f
}

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.WEB_ORIGIN ?? '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-token')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return void res.sendStatus(204)
    next()
  })
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false, limit: '64kb' }))

  app.get('/health', async (_req, res) => {
    await db.execute(sql`select 1`)
    res.json({ ok: true, time: Date.now() })
  })

  // --- Auth
  // ponytail: no rate limit on activation (8-digit codes, 48 h expiry); add express-rate-limit before a public deploy.
  app.post('/auth/activate', async (req, res) => {
    res.json(await activate(ActivateBody.parse(req.body)))
  })
  app.post('/auth/refresh', async (req, res) => {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'unauthenticated', 'Missing token')
    res.json(await refresh(h.slice(7)))
  })

  // --- Sync
  app.post('/sync/push', auth(), async (req, res) => {
    res.json(await push(deviceOf(res), PushBody.parse(req.body)))
  })
  app.get('/sync/pull', auth(), async (req, res) => {
    const device = deviceOf(res)
    res.json({ ...(await pull(device, PullQuery.parse(req.query))), keys: await keysFor(device) })
  })

  // --- Referrals (web inbox and facility devices)
  const facilityOrAdmin = auth({ roles: ['facility'], admin: true })
  app.get('/referrals', facilityOrAdmin, async (req, res) => {
    const f = await facilityFor(res, FacilityQuery.parse(req.query).facility)
    res.json({ referrals: await listReferrals(f.id) })
  })
  app.post('/referrals/:id/status', facilityOrAdmin, async (req, res) => {
    const { status } = z.object({ status: z.enum(WEB_STATUSES) }).parse(req.body)
    const actor = actorOf(res)
    res.json({ referral: await setStatus(z.string().max(64).parse(req.params.id), status, actor.kind === 'device' ? actor.device : null) })
  })

  app.get('/events', facilityOrAdmin, async (req, res) => {
    const f = await facilityFor(res, FacilityQuery.parse(req.query).facility)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`event: ready\ndata: ${JSON.stringify({ facility: f.code })}\n\n`)
    const onReferral = (v: ReferralView) => {
      if (visibleTo(f.id, v)) res.write(`event: referral\ndata: ${JSON.stringify(v)}\n\n`)
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
    bus.on('referral', onReferral)
    req.on('close', () => {
      clearInterval(ping)
      bus.off('referral', onReferral)
    })
  })

  // --- SMS gateway webhook (Arkesel inbound). Always 200 so the gateway does not retry a message we already judged.
  app.post('/sms/inbound', async (req, res) => {
    const token = process.env.SMS_WEBHOOK_TOKEN
    if (token && req.query.token !== token) throw new HttpError(401, 'unauthenticated', 'Bad webhook token')
    const b = z.object({ from: z.string().optional(), sender: z.string().optional(), text: z.string().optional(), message: z.string().optional() }).parse(req.body)
    const from = b.from ?? b.sender
    const text = b.text ?? b.message
    if (!from || text === undefined) throw new HttpError(400, 'invalid_request', 'Expected { from, text }')
    res.json(await handleInboundSms(from, text.slice(0, 1600)))
  })

  // --- Admin (ADMIN_TOKEN)
  const admin = auth({ admin: true, roles: [] })
  const publicDevice = ({ key_hex: _k, seq: _s, ...d }: typeof devices.$inferSelect) => d
  app.get('/admin/devices', admin, async (_req, res) => {
    res.json({ devices: (await db.select().from(devices).orderBy(devices.id)).map(publicDevice) })
  })
  app.post('/admin/devices', admin, async (req, res) => {
    const body = z.object({
      id: z.string().regex(/^[A-Z0-9]{2,8}$/).optional(),
      role: z.enum(['cho', 'volunteer', 'facility']),
      user_name: z.string().min(1).max(200),
      phone_number: z.string().max(20).optional(),
      facility_code: z.string().max(32),
    }).parse(req.body)
    const f = await facilityByCode(body.facility_code)
    const now = Date.now()
    const id = body.id ?? body.role[0]!.toUpperCase() + randomBytes(3).toString('hex').toUpperCase()
    const code = String(randomInt(10_000_000, 100_000_000))
    const expires_at = now + 48 * 3_600_000
    const device = await write(async (tx) => {
      const [d] = await tx.insert(devices).values({ id, role: body.role, user_name: body.user_name, phone_number: body.phone_number ?? null, facility_id: f.id, updated_at: now }).onConflictDoNothing().returning()
      if (!d) throw new HttpError(409, 'conflict', 'Device id already exists')
      await tx.insert(activation_codes).values({ code, device_id: id, expires_at })
      return d
    })
    res.status(201).json({ device: publicDevice(device), activation_code: code, expires_at })
  })
  app.post('/admin/devices/:id/deactivate', admin, async (req, res) => {
    const [d] = await write((tx) => tx.update(devices).set({ active: false, updated_at: Date.now() }).where(eq(devices.id, String(req.params.id))).returning())
    if (!d) throw new HttpError(404, 'not_found', 'Unknown device')
    res.json({ device: publicDevice(d) })
  })

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'No such route')))
  app.use(errorHandler)
  return app
}
