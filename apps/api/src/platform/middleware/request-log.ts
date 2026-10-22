import type { RequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import type { Logger } from '../logger.ts'

/** One line per request with a request id. Path only: query strings can carry SSE tickets or webhook tokens. */
export function requestLog(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = performance.now()
    const id = randomUUID()
    res.locals.requestId = id
    res.setHeader('X-Request-Id', id)
    res.on('finish', () => {
      if (req.path === '/health') return
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
      logger[level]('request', { id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(performance.now() - start) })
    })
    next()
  }
}
