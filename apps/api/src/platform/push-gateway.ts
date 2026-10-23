import type { Env } from '../config/env.ts'
import type { Logger } from './logger.ts'

export type PushMessage = { to: string; title: string; body: string; data: Record<string, string | number>; channelId: string }
/** Per message, in order. `gone` means the address no longer exists (app removed, token replaced): forget it. */
export type PushResult = 'ok' | 'gone' | 'failed'
export type PushGateway = { send(messages: PushMessage[]): Promise<PushResult[]> }

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH = 100

/**
 * Expo's push service, which hands Android messages to Firebase Cloud Messaging. High priority, so a sleeping
 * phone wakes. EXPO_ACCESS_TOKEN is needed only once the Expo project turns on enhanced push security. A failure
 * is logged and never thrown: the SMS is the path that must not depend on this one.
 */
export function createPushGateway(env: Env, logger: Logger): PushGateway {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) }
  return {
    async send(messages) {
      const out: PushResult[] = []
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH)
        try {
          const res = await fetch(EXPO_PUSH_URL, {
            method: 'POST', headers, signal: AbortSignal.timeout(10_000),
            body: JSON.stringify(batch.map((m) => ({ ...m, priority: 'high', sound: 'default' }))),
          })
          const json = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] }
          if (!res.ok || !Array.isArray(json.data)) {
            logger.warn('push_rejected', { status: res.status, count: batch.length })
            out.push(...batch.map(() => 'failed' as const))
            continue
          }
          out.push(...json.data.map((t) => (t.status === 'ok' ? 'ok' : t.details?.error === 'DeviceNotRegistered' ? 'gone' : 'failed') as PushResult))
        } catch (e) {
          logger.warn('push_unreachable', { error: String(e), count: batch.length })
          out.push(...batch.map(() => 'failed' as const))
        }
      }
      return out
    },
  }
}
