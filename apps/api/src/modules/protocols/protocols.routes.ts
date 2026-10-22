import { PROTOCOLS } from '@laafia/core'
import { Router, type RequestHandler } from 'express'
import type { Auth } from '../../platform/middleware/auth.ts'

/**
 * Read-only checklists for clinical review: each protocol exactly as phones run it (packages/core),
 * with its version and clinical_review note. No database, so the handler sits here.
 */
const list: RequestHandler = (_req, res) => {
  res.json({ protocols: Object.values(PROTOCOLS) })
}

export function createProtocolsRouter(auth: Auth) {
  return Router().get('/protocols', auth({ admin: true, roles: [], users: ['district_admin', 'supervisor', 'facility_staff'] }), list)
}
