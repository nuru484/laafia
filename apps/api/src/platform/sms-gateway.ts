import type { Env } from '../config/env.ts'
import { maskPhone, type Logger } from './logger.ts'

/** Outbound SMS. `msgid` comes back on Frog's delivery receipt (POST /sms/delivery). */
export type SmsGateway = { send(to: string, body: string, msgid: string): Promise<void> }

export const FROG_BASE_URL = 'https://frogapi.wigal.com.gh/api/v3'

/**
 * Frog by Wigal (house gateway, same calls as dms-backend): POST /api/v3/sms/send
 * with API-KEY and USERNAME headers and { senderid, destinations: [{ destination, msgid }],
 * message, smstype: 'text' }; success is status "ACCEPTD". Frog's text mode accepts
 * GSM-7 only; Laafia bodies are ASCII by construction (core codec).
 * Without FROG_API_KEY / FROG_USERNAME / FROG_SENDER_ID the message is only logged
 * (masked number and length, never the body).
 */
export function createSmsGateway(env: Env, logger: Logger): SmsGateway {
  return {
    async send(to, body, msgid) {
      if (!env.FROG_API_KEY || !env.FROG_USERNAME || !env.FROG_SENDER_ID) return logger.info('sms_dev_send', { to: maskPhone(to), length: body.length, msgid })
      const res = await fetch(`${FROG_BASE_URL}/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'API-KEY': env.FROG_API_KEY, USERNAME: env.FROG_USERNAME },
        body: JSON.stringify({ senderid: env.FROG_SENDER_ID, destinations: [{ destination: to, msgid }], message: body, smstype: 'text' }),
        signal: AbortSignal.timeout(15_000),
      })
      const json = (await res.json().catch(() => null)) as { status?: string; message?: string } | null
      // Frog's own message is safe to keep (it never echoes the body); the number and body are not logged.
      if (!res.ok || json?.status !== 'ACCEPTD') throw new Error(`frog ${res.status} ${json?.status ?? 'no_status'}: ${json?.message ?? 'no body'}`)
    },
  }
}
