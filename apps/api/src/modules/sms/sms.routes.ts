import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import { createSmsController } from './sms.controller.ts'
import { InboundBody } from './sms.schemas.ts'

export function createSmsRouter(deps: Deps) {
  const c = createSmsController(deps)
  return Router()
    .post('/sms/inbound', c.requireWebhookToken, validate({ body: InboundBody }), c.inbound)
    .post('/sms/delivery', c.requireCallbackSecret, c.delivery)
}
