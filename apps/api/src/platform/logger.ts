/** Structured JSON lines. Never pass secrets, SMS bodies or full phone numbers (spec 18.3). */
export type Logger = {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

export function createLogger(): Logger {
  const line = (level: 'info' | 'warn' | 'error') => (msg: string, extra: Record<string, unknown> = {}) =>
    console[level](JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra }))
  return { info: line('info'), warn: line('warn'), error: line('error') }
}

export const maskPhone = (p: string) => (p.length > 3 ? '*'.repeat(p.length - 3) + p.slice(-3) : '***')
