import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createDashboardController, SummaryQuery } from './dashboard.controller.ts'

export function createDashboardRouter(deps: Deps, auth: Auth) {
  const c = createDashboardController(deps)
  return Router().get('/dashboard/summary', auth({ admin: true, roles: [], users: ['supervisor', 'district_admin'] }), validate({ query: SummaryQuery }), c.get)
}
