import type { Env } from '../config/env.ts'
import { maskPhone, type Logger } from './logger.ts'

export type SmsGateway = { send(to: string, body: string): Promise<void> }

/** Ghana local 0XXXXXXXXX to the 233XXXXXXXXX form Arkesel expects. */
const international = (phone: string) => (phone.startsWith('0') ? '233' + phone.slice(1) : phone.replace(/^\+/, ''))

/**
 * Arkesel SMS API v2 (https://developers.arkesel.com): POST /api/v2/sms/send with an `api-key` header.
 * Without ARKESEL_API_KEY the message is only logged (masked number and length, never the body).
 */
export function createSmsGateway(env: Env, logger: Logger): SmsGateway {
  return {
    async send(to, body) {
      const key = env.ARKESEL_API_KEY
      if (!key) return logger.info('sms_dev_send', { to: maskPhone(to), length: body.length })
      const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: env.ARKESEL_SENDER, message: body, recipients: [international(to)] }),
        signal: AbortSignal.timeout(15_000),
      })
      const json = (await res.json().catch(() => null)) as { status?: string; message?: string } | null
      if (!res.ok || json?.status !== 'success') throw new Error(`arkesel ${res.status}: ${json?.message ?? 'no body'}`)
    },
  }
}
