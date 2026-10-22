import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { CreateDeviceBody, DeviceParams } from './admin.schemas.ts'
import { createDevice, deactivateDevice, listDevices, reissueCode } from './admin.service.ts'

export function createAdminController(deps: Deps) {
  const list: RequestHandler = async (_req, res) => {
    res.json({ devices: await listDevices(deps, actorOf(res)) })
  }
  const create: RequestHandler = async (_req, res) => {
    res.status(201).json(await createDevice(deps, actorOf(res), input(res, 'body', CreateDeviceBody)))
  }
  const deactivate: RequestHandler = async (_req, res) => {
    res.json(await deactivateDevice(deps, actorOf(res), input(res, 'params', DeviceParams).id))
  }
  const reissue: RequestHandler = async (_req, res) => {
    res.json(await reissueCode(deps, actorOf(res), input(res, 'params', DeviceParams).id))
  }
  return { list, create, deactivate, reissue }
}
