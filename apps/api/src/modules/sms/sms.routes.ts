import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createSmsController } from './sms.controller.ts'
import { InboundBody, LogQuery } from './sms.schemas.ts'

export function createSmsRouter(deps: Deps, auth: Auth) {
  const c = createSmsController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .post('/sms/inbound', c.requireWebhookToken, validate({ body: InboundBody }), c.inbound)
    .post('/sms/delivery', c.requireCallbackSecret, c.delivery)
    .get('/admin/sms/balance', admin, c.balance)
    .get('/admin/sms/log', admin, validate({ query: LogQuery }), c.log)
}
