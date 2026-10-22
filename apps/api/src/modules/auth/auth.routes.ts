import { Router, type RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input, validate } from '../../platform/http/validate.ts'
import { fixedWindow } from '../../platform/middleware/rate-limit.ts'
import { createAuthController } from './auth.controller.ts'
import { ActivateBody } from './auth.schemas.ts'

// Activation codes are 8 digits: 5 attempts per IP and per code in 15 minutes.
const byIp = fixedWindow(5, 15 * 60_000, 'Too many activation attempts; wait and try again')
const byCode = fixedWindow(5, 15 * 60_000, 'Too many attempts for this code; wait and try again')
export const resetActivationLimits = () => (byIp.reset(), byCode.reset())
const limitActivation: RequestHandler = (req, res, next) => {
  byIp.hit(req.ip ?? 'unknown')
  byCode.hit(input(res, 'body', ActivateBody).activation_code)
  next()
}

export function createAuthRouter(deps: Deps) {
  const c = createAuthController(deps)
  return Router()
    .post('/auth/activate', validate({ body: ActivateBody }), limitActivation, c.activateDevice)
    .post('/auth/refresh', c.refreshToken)
}
