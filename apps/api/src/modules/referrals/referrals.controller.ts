import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { deviceOrNull } from '../../platform/middleware/auth.ts'
import { FacilityQuery, IdParams, StatusBody } from './referrals.schemas.ts'
import { facilityFor, listReferrals, referralChain, setStatus } from './referrals.service.ts'

export function createReferralsController(deps: Deps) {
  const list: RequestHandler = async (_req, res) => {
    const f = await facilityFor(deps, deviceOrNull(res), input(res, 'query', FacilityQuery).facility)
    res.json({ referrals: await listReferrals(deps, f.id) })
  }
  const status: RequestHandler = async (_req, res) => {
    const { id } = input(res, 'params', IdParams)
    res.json({ referral: await setStatus(deps, id, input(res, 'body', StatusBody).status, deviceOrNull(res)) })
  }
  const get: RequestHandler = async (_req, res) => {
    res.json(await referralChain(deps, input(res, 'params', IdParams).id, deviceOrNull(res)))
  }
  return { list, status, get }
}
