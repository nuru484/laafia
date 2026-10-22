import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { ExportQuery, PushBody } from './dhis2.schemas.ts'
import { exportFor, pushToDhis2 } from './dhis2.service.ts'

export function createDhis2Controller(deps: Deps) {
  const exportJson: RequestHandler = async (_req, res) => {
    const q = input(res, 'query', ExportQuery)
    res.json(await exportFor(deps, q.facility, q.period))
  }
  const push: RequestHandler = async (_req, res) => {
    const b = input(res, 'body', PushBody)
    res.json(await pushToDhis2(deps, b.facility, b.period, b.dry_run))
  }
  return { exportJson, push }
}
