import type { Request, RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf, safeEqual } from '../../platform/middleware/auth.ts'
import { smsBalance, smsLog } from './sms.admin.ts'
import { InboundBody, LogQuery, receiptItems } from './sms.schemas.ts'
import { applyDeliveryReceipts, handleInboundSms } from './sms.service.ts'

/** A shared token from a header or, because a gateway dashboard can only carry a URL, ?token=. */
const tokenFrom = (req: Request, header: string) => {
  const given = req.headers[header] ?? req.query.token
  return typeof given === 'string' ? given : undefined
}

export function createSmsController(deps: Deps) {
  /**
   * Generic inbound SMS forwarder: guarded by SMS_WEBHOOK_TOKEN (header x-webhook-token or ?token=).
   * Required at boot in production; open only in development when unset.
   */
  const requireWebhookToken: RequestHandler = (req, _res, next) => {
    if (deps.env.SMS_WEBHOOK_TOKEN && !safeEqual(tokenFrom(req, 'x-webhook-token'), deps.env.SMS_WEBHOOK_TOKEN)) {
      throw new HttpError(401, 'unauthenticated', 'Bad webhook token')
    }
    next()
  }
  /**
   * Frog delivery receipts, verified as in dms-backend: SMS_CALLBACK_SECRET from header
   * x-callback-token or ?token=, constant-time. Fails closed when the secret is unset.
   */
  const requireCallbackSecret: RequestHandler = (req, _res, next) => {
    if (!deps.env.SMS_CALLBACK_SECRET) throw new HttpError(401, 'unauthenticated', 'SMS callback secret is not configured')
    if (!safeEqual(tokenFrom(req, 'x-callback-token'), deps.env.SMS_CALLBACK_SECRET)) throw new HttpError(401, 'unauthenticated', 'Invalid SMS callback token')
    next()
  }
  /** Always 200 so the gateway does not retry a message already judged. */
  const inbound: RequestHandler = async (_req, res) => {
    const { from, text } = input(res, 'body', InboundBody)
    if (!from || text === undefined) throw new HttpError(400, 'invalid_request', 'Expected { from, text }')
    res.json(await handleInboundSms(deps, from, text.slice(0, 1600)))
  }
  /** Always 200: each receipt is validated alone, so one bad receipt never drops the batch. */
  const delivery: RequestHandler = async (req, res) => {
    res.json(await applyDeliveryReceipts(deps, receiptItems(req.body)))
  }
  const balance: RequestHandler = async (_req, res) => {
    res.json(await smsBalance(deps))
  }
  const log: RequestHandler = async (_req, res) => {
    res.json(await smsLog(deps, actorOf(res), input(res, 'query', LogQuery)))
  }
  return { requireWebhookToken, requireCallbackSecret, inbound, delivery, balance, log }
}
