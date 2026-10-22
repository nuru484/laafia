import type { StatusCode } from './codec.ts'
import type { ReferralEvent, ReferralStatus } from './types.ts'

/*
 * Referral status is derived from its events, never stored on its own. The
 * same referral arrives by SMS, QR and HTTPS in any order, so status only
 * moves forward: an "arrived" that lands before "received" is still arrived.
 */

const ORDER: ReferralStatus[] = ['created', 'carrying', 'sent', 'received', 'arrived', 'treated', 'closed']

export function deriveStatus(events: Pick<ReferralEvent, 'status'>[]): ReferralStatus {
  if (events.some((e) => e.status === 'cancelled')) return 'cancelled'
  return events.reduce<ReferralStatus>((best, e) => (ORDER.indexOf(e.status) > ORDER.indexOf(best) ? e.status : best), 'created')
}

export const STATUS_FROM_CODE: Record<StatusCode, ReferralStatus> = { R: 'received', A: 'arrived', T: 'treated', C: 'closed' }
export const CODE_FROM_STATUS: Partial<Record<ReferralStatus, StatusCode>> = { received: 'R', arrived: 'A', treated: 'T', closed: 'C' }

const MIN = 60_000
const HOUR = 60 * MIN

/** No acknowledgement after this long: escalate to the backup number and offer a call. */
export const ACK_TIMEOUT_MS: Record<1 | 2 | 3, number> = { 3: 10 * MIN, 2: 30 * MIN, 1: 2 * HOUR }
/** Acknowledged but not arrived after this long: pin "did not arrive, visit" to the top of the list. */
export const ARRIVAL_WINDOW_MS: Record<1 | 2 | 3, number> = { 3: 6 * HOUR, 2: 24 * HOUR, 1: 72 * HOUR }

export type Alert = 'no_ack' | 'not_arrived' | null

export function referralAlert(events: Pick<ReferralEvent, 'status' | 'at'>[], urgency: 1 | 2 | 3, now: number): Alert {
  const status = deriveStatus(events)
  const at = (s: ReferralStatus) => events.find((e) => e.status === s)?.at
  const sentAt = at('sent') ?? at('carrying')
  if ((status === 'sent' || status === 'carrying') && sentAt !== undefined && now - sentAt >= ACK_TIMEOUT_MS[urgency]) return 'no_ack'
  const receivedAt = at('received')
  if (status === 'received' && receivedAt !== undefined && now - receivedAt >= ARRIVAL_WINDOW_MS[urgency]) return 'not_arrived'
  return null
}
