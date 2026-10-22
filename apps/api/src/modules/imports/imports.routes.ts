import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createImportsController } from './imports.controller.ts'
import { BatchListQuery, BatchParams, BatchReadParams, Dhis2Body, TemplateBody } from './imports.schemas.ts'

/** Register import pipeline, called by the web dashboard (district admins, scoped to their district). */
export function createImportsRouter(deps: Deps, auth: Auth) {
  const c = createImportsController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/admin/import/templates', admin, c.templates)
    .post('/admin/import/templates', admin, validate({ body: TemplateBody }), c.addTemplate)
    .post('/admin/import/preview', admin, c.upload, c.previewUpload)
    .post('/admin/import/dhis2/preview', admin, validate({ body: Dhis2Body }), c.previewFromDhis2)
    .get('/admin/import/batches', admin, validate({ query: BatchListQuery }), c.batches)
    .get('/admin/import/batches/:id', admin, validate({ params: BatchReadParams }), c.batch)
    .post('/admin/import/batches/:id/commit', admin, validate({ params: BatchParams }), c.commitBatch)
    .post('/admin/import/batches/:id/undo', admin, validate({ params: BatchParams }), c.undoBatch)
}
