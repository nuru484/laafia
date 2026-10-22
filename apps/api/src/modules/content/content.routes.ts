import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createContentController } from './content.controller.ts'
import { ClipParams, ClipQuery, PackParams } from './content.schemas.ts'

export function createContentRouter(deps: Deps, auth: Auth) {
  const c = createContentController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/content/manifest', auth(), c.getManifest)
    .get('/content/packs/:id', auth(), validate({ params: PackParams }), c.download)
    .post('/content/clips', auth({ roles: ['cho', 'facility'] }), c.clipUpload, c.createClip)
    .get('/content/clips', auth(), validate({ query: ClipQuery }), c.clips)
    .get('/content/clips/:id/file', auth(), validate({ params: ClipParams }), c.clipDownload)
    .get('/admin/content/packs', admin, c.list)
    .post('/admin/content/packs', admin, c.upload, c.create)
    .get('/admin/content/clips', admin, c.adminClips)
    .delete('/admin/content/clips/:id', admin, validate({ params: ClipParams }), c.removeClip)
}
