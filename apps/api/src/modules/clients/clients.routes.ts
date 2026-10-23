import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createClientsController } from './clients.controller.ts'
import { ClientParams, MergeBody } from './clients.schemas.ts'

export function createClientsRouter(deps: Deps, auth: Auth) {
  const c = createClientsController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/admin/clients/duplicates', admin, c.listDuplicates)
    .post('/admin/clients/:id/merge', admin, validate({ params: ClientParams, body: MergeBody }), c.merge)
}
