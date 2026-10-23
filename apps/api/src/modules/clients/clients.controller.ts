import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { ClientParams, MergeBody } from './clients.schemas.ts'
import { duplicates, mergeClient } from './clients.service.ts'

export function createClientsController(deps: Deps) {
  const listDuplicates: RequestHandler = async (_req, res) => {
    res.json({ groups: await duplicates(deps, actorOf(res)) })
  }
  const merge: RequestHandler = async (_req, res) => {
    res.json(await mergeClient(deps, actorOf(res), input(res, 'params', ClientParams).id, input(res, 'body', MergeBody).into))
  }
  return { listDuplicates, merge }
}
