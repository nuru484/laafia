import type { Deps } from '../../platform/deps.ts'
import type { PushMessage } from '../../platform/push-gateway.ts'
import type { ReferralView } from './referrals.service.ts'

const WHO: Record<string, string> = { pregnant: 'Pregnant woman', postpartum: 'Mother after delivery', newborn: 'Newborn', child: 'Child' }
const STEP: Record<string, string> = { received: 'received', arrived: 'arrived', treated: 'treated', closed: 'discharged' }
const REMEMBER = 5000

/**
 * The internet path of a referral. A new referral is pushed to the phones at its destination, so they ring at
 * once instead of at their next sync; each step the facility takes is pushed to the CHO who sent it, which is also
 * how her phone learns it can hold back the referral SMS. Every write to a referral passes the bus, so this sees
 * them all; `last` keeps one push per referral and step.
 */
export function startReferralPush(deps: Deps): () => void {
  const last = new Map<string, string>()
  const onReferral = (v: ReferralView) => {
    const step = v.status === 'created' || v.status === 'sent' ? 'new' : v.status
    if (last.get(v.id) === step || !(step === 'new' || step in STEP)) return
    last.set(v.id, step)
    if (last.size > REMEMBER) last.delete(last.keys().next().value!)
    void notify(deps, v, step).catch((e: unknown) => deps.logger.warn('push_notify_failed', { referral: v.id, error: String(e) }))
  }
  deps.bus.on('referral', onReferral)
  return () => deps.bus.off('referral', onReferral)
}

async function notify(deps: Deps, v: ReferralView, step: string) {
  const who = `${WHO[v.client_type ?? ''] ?? 'Client'} ${v.client_code ?? ''}`.trim()
  const phones = step === 'new'
    ? await deps.prisma.device.findMany({ where: { role: 'facility', active: true, facilityId: v.destination_facility_id ?? '-', pushToken: { not: null } }, select: { id: true, pushToken: true } })
    : await deps.prisma.device.findMany({ where: { id: v.origin_device_id, active: true, pushToken: { not: null } }, select: { id: true, pushToken: true } })
  if (!phones.length) return
  const message = (to: string): PushMessage => step === 'new'
    ? { to, channelId: 'laafia_referrals', title: v.urgency === 3 ? 'EMERGENCY referral coming' : `Referral coming (urgency ${v.urgency ?? '?'})`, body: `${who}. Open Laafia to see the assessment and acknowledge.`, data: { kind: 'referral', referral_id: v.id } }
    : { to, channelId: 'laafia_updates', title: `Referral ${STEP[step]}`, body: `${who}, referral ${v.short_id}: ${STEP[step]} at the facility.`, data: { kind: 'status', referral_id: v.id, status: step } }
  const results = await deps.push.send(phones.map((p) => message(p.pushToken!)))
  const gone = phones.filter((_, i) => results[i] === 'gone').map((p) => p.id)
  if (gone.length) await deps.prisma.device.updateMany({ where: { id: { in: gone } }, data: { pushToken: null } })
}
