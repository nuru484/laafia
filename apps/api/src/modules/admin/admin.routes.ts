import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createAdminController } from './admin.controller.ts'
import { CreateDeviceBody, DeviceParams, UpdateDeviceBody } from './admin.schemas.ts'

export function createAdminRouter(deps: Deps, auth: Auth) {
  const c = createAdminController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/admin/devices', admin, c.list)
    .post('/admin/devices', admin, validate({ body: CreateDeviceBody }), c.create)
    .patch('/admin/devices/:id', admin, validate({ params: DeviceParams, body: UpdateDeviceBody }), c.update)
    .post('/admin/devices/:id/deactivate', admin, validate({ params: DeviceParams }), c.deactivate)
    .post('/admin/devices/:id/code', admin, validate({ params: DeviceParams }), c.reissue)
}
