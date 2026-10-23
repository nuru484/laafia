import type { Express } from 'express'
import type { Deps } from './platform/deps.ts'
import { createAuth } from './platform/middleware/auth.ts'
import { createAdminRouter } from './modules/admin/index.ts'
import { createAuditRouter } from './modules/audit/index.ts'
import { createClientsRouter } from './modules/clients/index.ts'
import { createFacilitiesRouter } from './modules/facilities/index.ts'
import { createAuthRouter } from './modules/auth/index.ts'
import { createDashboardRouter } from './modules/dashboard/index.ts'
import { createEventsRouter } from './modules/events/index.ts'
import { createProtocolsRouter } from './modules/protocols/protocols.routes.ts'
import { createReferralsRouter } from './modules/referrals/index.ts'
import { startReferralPush } from './modules/referrals/referrals.push.ts'
import { createSmsRouter } from './modules/sms/index.ts'
import { createSyncRouter } from './modules/sync/index.ts'
import { createUsersRouter } from './modules/users/index.ts'

/** Mounts every feature module's router. Each module owns its paths (docs/API.md). */
export function mountModules(app: Express, deps: Deps) {
  const auth = createAuth(deps)
  app.use(createAuthRouter(deps))
  app.use(createUsersRouter(deps, auth))
  app.use(createDashboardRouter(deps, auth))
  app.use(createSyncRouter(deps, auth))
  app.use(createReferralsRouter(deps, auth))
  app.use(createEventsRouter(deps, auth))
  app.use(createSmsRouter(deps, auth))
  app.use(createAdminRouter(deps, auth))
  app.use(createFacilitiesRouter(deps, auth))
  app.use(createClientsRouter(deps, auth))
  app.use(createAuditRouter(deps, auth))
  app.use(createProtocolsRouter(auth))
  startReferralPush(deps)
}
