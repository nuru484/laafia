import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import type { Logger } from '../logger.ts'

/** Error body everywhere: { status, code, message, details? }. Codes are stable; clients branch on `code`. */
export class HttpError extends Error {
  retryAfter?: number
  constructor(public status: number, public code: string, message = code) {
    super(message)
  }
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ status: 400, code: 'invalid_request', message: 'Request failed validation', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      return
    }
    if (err instanceof HttpError) {
      if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter))
      res.status(err.status).json({ status: err.status, code: err.code, message: err.message })
      return
    }
    if (err?.name === 'MulterError') {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
      res.status(status).json({ status, code: status === 413 ? 'too_large' : 'invalid_upload', message: err.message })
      return
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      const status = err.status ?? 400
      res.status(status).json({ status, code: err.type === 'entity.too.large' ? 'too_large' : 'invalid_json', message: err.message })
      return
    }
    logger.error('unhandled', { path: req.path, error: String(err?.stack ?? err) })
    res.status(500).json({ status: 500, code: 'internal', message: 'Internal error' })
  }
}
