import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { CreateFacilityBody, FacilityParams, UpdateFacilityBody } from './facilities.schemas.ts'
import { createFacility, listFacilities, updateFacility } from './facilities.service.ts'

export function createFacilitiesController(deps: Deps) {
  const list: RequestHandler = async (_req, res) => {
    res.json({ facilities: await listFacilities(deps, actorOf(res)) })
  }
  const create: RequestHandler = async (_req, res) => {
    res.status(201).json({ facility: await createFacility(deps, actorOf(res), input(res, 'body', CreateFacilityBody)) })
  }
  const update: RequestHandler = async (_req, res) => {
    res.json({ facility: await updateFacility(deps, actorOf(res), input(res, 'params', FacilityParams).id, input(res, 'body', UpdateFacilityBody)) })
  }
  return { list, create, update }
}
