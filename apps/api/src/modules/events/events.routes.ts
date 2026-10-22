import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { validate } from '../../platform/http/validate.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createEventsController } from './events.controller.ts'
import { StreamQuery, TicketBody } from './events.schemas.ts'

export function createEventsRouter(deps: Deps, auth: Auth) {
  const c = createEventsController(deps)
  return Router()
    .post('/events/ticket', auth({ roles: ['facility'], admin: true }), validate({ body: TicketBody }), c.ticket)
    .get('/events', validate({ query: StreamQuery }), c.stream)
}
