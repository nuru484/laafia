import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { deviceOf } from '../../platform/middleware/auth.ts'
import { PullQuery, PushBody } from './sync.schemas.ts'
import { pull, push } from './sync.service.ts'

export function createSyncController(deps: Deps) {
  const pushRows: RequestHandler = async (_req, res) => {
    res.json(await push(deps, deviceOf(res), input(res, 'body', PushBody)))
  }
  const pullRows: RequestHandler = async (_req, res) => {
    res.json(await pull(deps, deviceOf(res), input(res, 'query', PullQuery)))
  }
  return { pushRows, pullRows }
}
