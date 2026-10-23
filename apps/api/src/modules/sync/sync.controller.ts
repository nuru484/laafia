import type { Request, RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { deviceOf } from '../../platform/middleware/auth.ts'
import { PullQuery, PushBody, PushTokenBody } from './sync.schemas.ts'
import { pull, push, recordContact, setPushToken } from './sync.service.ts'

const appVersion = (req: Request) => {
  const v = req.headers['x-app-version']
  return typeof v === 'string' && /^[\w.+-]{1,32}$/.test(v) ? v : null
}

export function createSyncController(deps: Deps) {
  const pushRows: RequestHandler = async (req, res) => {
    const device = deviceOf(res)
    await recordContact(deps, device.id, appVersion(req))
    res.json(await push(deps, device, input(res, 'body', PushBody)))
  }
  const pullRows: RequestHandler = async (req, res) => {
    const device = deviceOf(res)
    await recordContact(deps, device.id, appVersion(req))
    res.json(await pull(deps, device, input(res, 'query', PullQuery)))
  }
  const pushToken: RequestHandler = async (_req, res) => {
    await setPushToken(deps, deviceOf(res).id, input(res, 'body', PushTokenBody).token)
    res.json({ ok: true })
  }
  return { pushRows, pullRows, pushToken }
}
