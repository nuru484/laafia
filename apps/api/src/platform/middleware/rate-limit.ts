import { HttpError } from '../http/errors.ts'

/**
 * Fixed-window counter. `hit` throws 429 rate_limited (with Retry-After) once a key passes `max` in the window.
 * Limit: counters live in memory, so they are per process. Several API processes need a shared store.
 */
export function fixedWindow(max: number, windowMs: number, message: string, clock: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    hit(key: string) {
      const now = clock()
      const w = windows.get(key)
      if (!w || now - w.start >= windowMs) {
        if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k)
        return void windows.set(key, { start: now, count: 1 })
      }
      if (w.count >= max) {
        const err = new HttpError(429, 'rate_limited', message)
        err.retryAfter = Math.max(1, Math.ceil((w.start + windowMs - now) / 1000))
        throw err
      }
      w.count += 1
    },
    reset: () => windows.clear(),
  }
}
