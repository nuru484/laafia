import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { summary } from './dashboard.service.ts'

export const SummaryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), district: z.string().max(16).optional() })

export function createDashboardController(deps: Deps) {
  const get: RequestHandler = async (_req, res) => {
    const q = input(res, 'query', SummaryQuery)
    res.json(await summary(deps, actorOf(res), q.days, q.district))
  }
  return { get }
}
