import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createFacilitiesController } from './facilities.controller.ts'
import { CreateFacilityBody, FacilityParams, UpdateFacilityBody } from './facilities.schemas.ts'

export function createFacilitiesRouter(deps: Deps, auth: Auth) {
  const c = createFacilitiesController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    // Every dashboard role reads the facilities in its scope (board filters, inbox header).
    .get('/admin/facilities', auth({ admin: true, roles: [], users: ['district_admin', 'supervisor', 'facility_staff'] }), c.list)
    .post('/admin/facilities', admin, validate({ body: CreateFacilityBody }), c.create)
    .patch('/admin/facilities/:id', admin, validate({ params: FacilityParams, body: UpdateFacilityBody }), c.update)
}
