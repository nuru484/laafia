import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import { PHONES, type Auth } from '../../platform/middleware/auth.ts'
import { createSyncController } from './sync.controller.ts'
import { PullQuery, PushBody } from './sync.schemas.ts'

export function createSyncRouter(deps: Deps, auth: Auth) {
  const c = createSyncController(deps)
  return Router()
    .post('/sync/push', auth({ roles: PHONES }), validate({ body: PushBody }), c.pushRows)
    .get('/sync/pull', auth({ roles: PHONES }), validate({ query: PullQuery }), c.pullRows)
}
