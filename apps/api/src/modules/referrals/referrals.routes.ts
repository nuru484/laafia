import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createReferralsController } from './referrals.controller.ts'
import { FacilityQuery, IdParams, StatusBody } from './referrals.schemas.ts'

export function createReferralsRouter(deps: Deps, auth: Auth) {
  const c = createReferralsController(deps)
  const facilityOrAdmin = auth({ roles: ['facility'], admin: true })
  return Router()
    .get('/referrals', facilityOrAdmin, validate({ query: FacilityQuery }), c.list)
    .get('/referrals/:id', auth({ admin: true }), validate({ params: IdParams }), c.get)
    .post('/referrals/:id/status', facilityOrAdmin, validate({ params: IdParams, body: StatusBody }), c.status)
}
