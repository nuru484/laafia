import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { maskPhone } from '../../platform/logger.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { districtOrThrow } from '../../platform/scope.ts'

/* The SMS gateway panel: Frog balance and the server-sent SMS log. Never bodies or full numbers. */

export async function smsBalance(deps: Deps) {
  let b
  try {
    b = await deps.sms.getBalance()
  } catch (e) {
    deps.logger.warn('sms_balance_failed', { error: String(e).slice(0, 200) })
    throw new HttpError(502, 'sms_balance_unavailable', 'Could not reach the SMS gateway for its balance')
  }
  if (!b) return { configured: false, balance: null, currency: null, sms_units: null }
  return { configured: true, balance: b.cash, currency: 'GHS', sms_units: b.smsUnits }
}

type Kind = 'ack' | 'status' | 'driver' | 'referral'
const kindOf = (purpose: string | null, body: string): Kind =>
  (purpose as Kind | null) ?? (body.startsWith('LFR|') ? 'referral' : body.startsWith('LAAFIA pickup') ? 'driver' : 'status')

export async function smsLog(deps: Deps, actor: Actor, q: { limit: number; before?: number }) {
  const rows = await deps.prisma.job.findMany({
    where: {
      kind: 'sms',
      ...(actor.kind === 'user' ? { districtId: districtOrThrow(actor) } : {}),
      ...(q.before ? { createdAt: { lt: q.before } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
  const page = rows.slice(0, q.limit)
  return {
    messages: page.map((j) => {
      const { to, body } = j.payload as { to: string; body: string }
      const status = j.status === 'pending' ? 'queued'
        : j.status === 'failed' || j.deliveryStatus === 'failed' ? 'failed'
        : j.deliveryStatus === 'delivered' ? 'delivered' : 'sent'
      return {
        id: String(j.id), at: j.createdAt, to_masked: maskPhone(to), kind: kindOf(j.purpose, body), status, attempts: j.attempts,
        error: status === 'failed' ? (j.deliveryReason ?? j.lastError) : j.status === 'pending' ? j.lastError : null,
        delivered_at: j.deliveredAt,
      }
    }),
    next_before: rows.length > q.limit ? page[page.length - 1]!.createdAt : null,
  }
}
