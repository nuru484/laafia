import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createTransportController } from './transport.controller.ts'
import { ProviderBody, ProviderParams, ProviderPatch, RequestBody } from './transport.schemas.ts'

export function createTransportRouter(deps: Deps, auth: Auth) {
  const c = createTransportController(deps)
  const staff = auth({ roles: ['cho', 'facility'] })
  return Router()
    .get('/transport/providers', auth(), c.list)
    .post('/transport/providers', staff, validate({ body: ProviderBody }), c.create)
    .patch('/transport/providers/:id', staff, validate({ params: ProviderParams, body: ProviderPatch }), c.update)
    .post('/transport/requests', auth({ roles: ['cho'] }), validate({ body: RequestBody }), c.request)
}
