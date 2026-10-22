import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import { PHONES, type Auth } from '../../platform/middleware/auth.ts'
import { createTransportController } from './transport.controller.ts'
import { AdminProviderBody, ProviderBody, ProviderParams, ProviderPatch, RequestBody } from './transport.schemas.ts'

export function createTransportRouter(deps: Deps, auth: Auth) {
  const c = createTransportController(deps)
  const staff = auth({ roles: ['cho', 'facility'] })
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/transport/providers', auth({ roles: PHONES }), c.list)
    .post('/transport/providers', staff, validate({ body: ProviderBody }), c.create)
    .patch('/transport/providers/:id', staff, validate({ params: ProviderParams, body: ProviderPatch }), c.update)
    .post('/transport/requests', auth({ roles: ['cho'] }), validate({ body: RequestBody }), c.request)
    .get('/admin/transport/providers', admin, c.adminList)
    .post('/admin/transport/providers', admin, validate({ body: AdminProviderBody }), c.adminCreate)
    .patch('/admin/transport/providers/:id', admin, validate({ params: ProviderParams, body: ProviderPatch }), c.adminUpdate)
}
