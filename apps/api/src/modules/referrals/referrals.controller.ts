import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { facilityScope } from '../../platform/scope.ts'
import { IdParams, ListQuery, OnwardBody, StatusBody } from './referrals.schemas.ts'
import { facilityFor, listReferrals, referralChain, setStatus } from './referrals.service.ts'
import { clientForReferral, referOnward } from './referrals.staff.ts'

export function createReferralsController(deps: Deps) {
  /** One facility (?facility=) or, for district users without it, every facility in scope. */
  const list: RequestHandler = async (_req, res) => {
    const actor = actorOf(res)
    const q = input(res, 'query', ListQuery)
    const ids = q.facility ? [(await facilityFor(deps, actor, q.facility)).id] : await facilityScope(deps, actor)
    res.json({ referrals: await listReferrals(deps, ids, { status: q.status, urgency: q.urgency }) })
  }
  const status: RequestHandler = async (_req, res) => {
    const { id } = input(res, 'params', IdParams)
    res.json({ referral: await setStatus(deps, id, input(res, 'body', StatusBody).status, actorOf(res)) })
  }
  const get: RequestHandler = async (_req, res) => {
    res.json(await referralChain(deps, input(res, 'params', IdParams).id, actorOf(res)))
  }
  const onward: RequestHandler = async (_req, res) => {
    res.status(201).json({ referral: await referOnward(deps, actorOf(res), input(res, 'params', IdParams).id, input(res, 'body', OnwardBody)) })
  }
  const client: RequestHandler = async (_req, res) => {
    res.json(await clientForReferral(deps, actorOf(res), input(res, 'params', IdParams).id))
  }
  return { list, status, get, onward, client }
}
