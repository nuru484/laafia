import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { AuditQuery, createAuditController } from './audit.controller.ts'

export function createAuditRouter(deps: Deps, auth: Auth) {
  const c = createAuditController(deps)
  return Router().get('/admin/audit', auth({ admin: true, roles: [], users: ['district_admin'] }), validate({ query: AuditQuery }), c.list)
}
