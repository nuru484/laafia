import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createContentController } from './content.controller.ts'
import { PackParams } from './content.schemas.ts'

export function createContentRouter(deps: Deps, auth: Auth) {
  const c = createContentController(deps)
  const admin = auth({ admin: true, roles: [] })
  return Router()
    .get('/content/manifest', auth(), c.getManifest)
    .get('/content/packs/:id', auth(), validate({ params: PackParams }), c.download)
    .get('/admin/content/packs', admin, c.list)
    .post('/admin/content/packs', admin, c.upload, c.create)
}
