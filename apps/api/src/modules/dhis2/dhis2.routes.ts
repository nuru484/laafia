import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createDhis2Controller } from './dhis2.controller.ts'
import { ExportQuery, PushBody } from './dhis2.schemas.ts'

export function createDhis2Router(deps: Deps, auth: Auth) {
  const c = createDhis2Controller(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/export/dhis2', admin, validate({ query: ExportQuery }), c.exportJson)
    .post('/export/dhis2', admin, validate({ body: PushBody }), c.push)
}
