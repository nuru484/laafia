import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { listAudit } from './audit.service.ts'

export const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
  target_type: z.string().max(32).optional(),
})

export function createAuditController(deps: Deps) {
  const list: RequestHandler = async (_req, res) => {
    res.json(await listAudit(deps, actorOf(res), input(res, 'query', AuditQuery)))
  }
  return { list }
}
