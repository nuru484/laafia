import express from 'express'
import { mountModules } from './modules.ts'
import type { Deps } from './platform/deps.ts'
import { createErrorHandler, HttpError } from './platform/http/errors.ts'
import { requestLog } from './platform/middleware/request-log.ts'

export function createApp(deps: Deps) {
  const app = express()
  app.disable('x-powered-by')
  // req.ip honours X-Forwarded-For only from these proxies (default: loopback, i.e. a reverse proxy on the same host).
  app.set('trust proxy', deps.env.TRUST_PROXY)
  app.use(requestLog(deps.logger))
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', deps.env.WEB_ORIGIN ?? '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-admin-token')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') return void res.sendStatus(204)
    next()
  })
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false, limit: '64kb' }))

  app.get('/health', async (_req, res) => {
    // Raw: a connectivity probe; there is no model to query.
    await deps.prisma.$queryRaw`select 1`
    res.json({ ok: true, time: deps.clock() })
  })

  mountModules(app, deps)

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'No such route')))
  app.use(createErrorHandler(deps.logger))
  return app
}
