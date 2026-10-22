import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { input } from '../../platform/http/validate.ts'
import { ActivateBody } from './auth.schemas.ts'
import { activate, refresh } from './auth.service.ts'

export function createAuthController(deps: Deps) {
  const activateDevice: RequestHandler = async (_req, res) => {
    res.json(await activate(deps, input(res, 'body', ActivateBody)))
  }
  const refreshToken: RequestHandler = async (req, res) => {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'unauthenticated', 'Missing token')
    res.json(await refresh(deps, h.slice(7)))
  }
  return { activateDevice, refreshToken }
}
