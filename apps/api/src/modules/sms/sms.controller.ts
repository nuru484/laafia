import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { input } from '../../platform/http/validate.ts'
import { safeEqual } from '../../platform/middleware/auth.ts'
import { InboundBody } from './sms.schemas.ts'
import { handleInboundSms } from './sms.service.ts'

export function createSmsController(deps: Deps) {
  /**
   * Arkesel documents no webhook signature, so a shared token (header x-webhook-token, or ?token= in the
   * configured URL) guards the webhook. Required at boot in production; open only in development when unset.
   */
  const requireWebhookToken: RequestHandler = (req, _res, next) => {
    if (deps.env.SMS_WEBHOOK_TOKEN) {
      const given = req.headers['x-webhook-token'] ?? req.query.token
      if (!safeEqual(typeof given === 'string' ? given : undefined, deps.env.SMS_WEBHOOK_TOKEN)) throw new HttpError(401, 'unauthenticated', 'Bad webhook token')
    }
    next()
  }
  /** Always 200 so the gateway does not retry a message already judged. */
  const inbound: RequestHandler = async (_req, res) => {
    const { from, text } = input(res, 'body', InboundBody)
    if (!from || text === undefined) throw new HttpError(400, 'invalid_request', 'Expected { from, text }')
    res.json(await handleInboundSms(deps, from, text.slice(0, 1600)))
  }
  return { requireWebhookToken, inbound }
}
