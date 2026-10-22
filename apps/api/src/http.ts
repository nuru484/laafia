import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'

/** Error body everywhere: { status, code, message, details? }. Codes are stable; clients branch on `code`. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) {
    super(message)
  }
}

export const log = (level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra }))

/**
 * Fixed-window counter. `hit` throws 429 rate_limited (with Retry-After) once a key passes `max` in the window.
 * ponytail: in memory, so per process; move to the database when running several API processes.
 */
export function fixedWindow(max: number, windowMs: number, message: string) {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    hit(key: string) {
      const now = Date.now()
      const w = windows.get(key)
      if (!w || now - w.start >= windowMs) {
        if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k)
        return void windows.set(key, { start: now, count: 1 })
      }
      if (w.count >= max) {
        const err = new HttpError(429, 'rate_limited', message) as HttpError & { retryAfter?: number }
        err.retryAfter = Math.max(1, Math.ceil((w.start + windowMs - now) / 1000))
        throw err
      }
      w.count += 1
    },
    reset: () => windows.clear(),
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ status: 400, code: 'invalid_request', message: 'Request failed validation', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
    return
  }
  if (err instanceof HttpError) {
    const retryAfter = (err as HttpError & { retryAfter?: number }).retryAfter
    if (retryAfter) res.setHeader('Retry-After', String(retryAfter))
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
  log('error', 'unhandled', { path: req.path, error: String(err?.stack ?? err) })
  res.status(500).json({ status: 500, code: 'internal', message: 'Internal error' })
}
