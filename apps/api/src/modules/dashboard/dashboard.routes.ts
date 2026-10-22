import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createDashboardController, OverviewQuery, SummaryQuery } from './dashboard.controller.ts'

export function createDashboardRouter(deps: Deps, auth: Auth) {
  const c = createDashboardController(deps)
  const users = auth({ admin: true, roles: [], users: ['supervisor', 'district_admin', 'facility_staff'] })
  return Router()
    .get('/dashboard/summary', users, validate({ query: SummaryQuery }), c.get)
    .get('/dashboard/overview', users, validate({ query: OverviewQuery }), c.overview)
}
