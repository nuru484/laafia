import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createReferralsController } from './referrals.controller.ts'
import { IdParams, ListQuery, OnwardBody, StatusBody } from './referrals.schemas.ts'

export function createReferralsRouter(deps: Deps, auth: Auth) {
  const c = createReferralsController(deps)
  // Facility phones and dashboard users read; supervisors read only. Scope is checked in the services.
  const read = auth({ roles: ['facility'], admin: true, users: ['facility_staff', 'district_admin', 'supervisor'] })
  const act = auth({ roles: ['facility'], admin: true, users: ['facility_staff', 'district_admin'] })
  const staff = auth({ admin: true, roles: [], users: ['facility_staff', 'district_admin'] })
  return Router()
    .get('/referrals', read, validate({ query: ListQuery }), c.list)
    .get('/referrals/:id', auth({ admin: true, users: ['facility_staff', 'district_admin', 'supervisor'] }), validate({ params: IdParams }), c.get)
    .post('/referrals/:id/status', act, validate({ params: IdParams, body: StatusBody }), c.status)
    .post('/referrals/:id/onward', staff, validate({ params: IdParams, body: OnwardBody }), c.onward)
    .get('/referrals/:id/client', staff, validate({ params: IdParams }), c.client)
}
