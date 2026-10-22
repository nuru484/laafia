import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { CreateDeviceBody, DeviceParams } from './admin.schemas.ts'
import { createDevice, deactivateDevice, listDevices } from './admin.service.ts'

export function createAdminController(deps: Deps) {
  const list: RequestHandler = async (_req, res) => {
    res.json({ devices: await listDevices(deps) })
  }
  const create: RequestHandler = async (_req, res) => {
    res.status(201).json(await createDevice(deps, input(res, 'body', CreateDeviceBody)))
  }
  const deactivate: RequestHandler = async (_req, res) => {
    res.json(await deactivateDevice(deps, input(res, 'params', DeviceParams).id))
  }
  return { list, create, deactivate }
}
