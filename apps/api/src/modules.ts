import type { Express } from 'express'
import type { Deps } from './platform/deps.ts'
import { createAuth } from './platform/middleware/auth.ts'
import { createAdminRouter } from './modules/admin/index.ts'
import { createAuthRouter } from './modules/auth/index.ts'
import { createContentRouter } from './modules/content/index.ts'
import { createEventsRouter } from './modules/events/index.ts'
import { createImportsRouter } from './modules/imports/index.ts'
import { createReferralsRouter } from './modules/referrals/index.ts'
import { createSmsRouter } from './modules/sms/index.ts'
import { createSyncRouter } from './modules/sync/index.ts'
import { createTransportRouter } from './modules/transport/index.ts'
import { createVoiceRouter } from './modules/voice/index.ts'

/** Mounts every feature module's router. Each module owns its paths (docs/API.md). */
export function mountModules(app: Express, deps: Deps) {
  const auth = createAuth(deps)
  app.use(createAuthRouter(deps))
  app.use(createSyncRouter(deps, auth))
  app.use(createReferralsRouter(deps, auth))
  app.use(createEventsRouter(deps, auth))
  app.use(createSmsRouter(deps))
  app.use(createContentRouter(deps, auth))
  app.use(createVoiceRouter(deps, auth))
  app.use(createTransportRouter(deps, auth))
  app.use(createImportsRouter(deps, auth))
  app.use(createAdminRouter(deps, auth))
}
