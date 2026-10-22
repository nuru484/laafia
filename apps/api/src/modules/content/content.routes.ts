import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import { PHONES, type Auth } from '../../platform/middleware/auth.ts'
import { createContentController } from './content.controller.ts'
import { BuildBody, ClipParams, ClipQuery, DistrictParams, MatrixQuery, PackParams } from './content.schemas.ts'

export function createContentRouter(deps: Deps, auth: Auth) {
  const c = createContentController(deps)
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .get('/content/manifest', auth({ roles: PHONES }), c.getManifest)
    .get('/content/packs/:id', auth({ roles: PHONES }), validate({ params: PackParams }), c.download)
    .post('/content/clips', auth({ roles: ['cho', 'facility'] }), c.clipUpload, c.createClip)
    .get('/content/clips', auth({ roles: PHONES }), validate({ query: ClipQuery }), c.clips)
    .get('/content/clips/:id/file', auth({ roles: PHONES, admin: true, users: ['district_admin'] }), validate({ params: ClipParams }), c.clipDownload)
    .get('/admin/content/packs', admin, c.list)
    .post('/admin/content/packs', admin, c.upload, c.create)
    .get('/admin/content/clips', admin, validate({ query: ClipQuery }), c.adminClips)
    .get('/admin/content/clips/:id/file', admin, validate({ params: ClipParams }), c.clipDownload)
    .delete('/admin/content/clips/:id', admin, validate({ params: ClipParams }), c.removeClip)
    .post('/admin/content/clips', admin, c.webClipUpload, c.createWebClip)
    .get('/admin/content/clips/matrix', admin, validate({ query: MatrixQuery }), c.matrix)
    .get('/admin/maps/:district', admin, validate({ params: DistrictParams }), c.mapArea)
    .post('/admin/maps/:district/builds', admin, validate({ params: DistrictParams, body: BuildBody }), c.startMapBuild)
}
