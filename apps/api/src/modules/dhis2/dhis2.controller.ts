import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { ExportQuery, HistoryQuery, PendingQuery, PushBody } from './dhis2.schemas.ts'
import { exportFor, exportHistory, pendingPeriods, pushToDhis2 } from './dhis2.service.ts'

export function createDhis2Controller(deps: Deps) {
  const exportJson: RequestHandler = async (_req, res) => {
    const q = input(res, 'query', ExportQuery)
    res.json(await exportFor(deps, actorOf(res), q.facility, q.period))
  }
  const push: RequestHandler = async (_req, res) => {
    const b = input(res, 'body', PushBody)
    res.json(await pushToDhis2(deps, actorOf(res), b.facility, b.period, b.dry_run))
  }
  const history: RequestHandler = async (_req, res) => {
    const q = input(res, 'query', HistoryQuery)
    res.json(await exportHistory(deps, actorOf(res), q.facility, q.limit))
  }
  const pending: RequestHandler = async (_req, res) => {
    const q = input(res, 'query', PendingQuery)
    res.json(await pendingPeriods(deps, actorOf(res), q.facility, q.months))
  }
  return { exportJson, push, history, pending }
}
