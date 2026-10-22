import { PROTOCOLS, type ReferralStatus } from '@laafia/core'

export const TYPE_LABEL: Record<string, string> = { pregnant: 'Pregnant woman', postpartum: 'Mother after delivery', newborn: 'Newborn', child: 'Child' }

export const STATUS_LABEL: Record<ReferralStatus, string> = {
  created: 'Not sent', carrying: 'Carried by hand', sent: 'Sent, not acknowledged', received: 'Received',
  arrived: 'Arrived', treated: 'Treated', closed: 'Closed', cancelled: 'Cancelled',
}

export const STATUS_ORDER: ReferralStatus[] = ['created', 'carrying', 'sent', 'received', 'arrived', 'treated', 'closed']
export const OPEN: ReferralStatus[] = ['created', 'carrying', 'sent', 'received', 'arrived', 'treated']

export function statusTone(s: ReferralStatus): string {
  if (s === 'created' || s === 'carrying' || s === 'sent') return 'bg-followup-tint text-followup'
  if (s === 'cancelled') return 'bg-muted text-muted-foreground'
  return 'bg-routine-tint text-routine'
}

export function urgencyTone(u: number | null): string {
  return u === 3 ? 'bg-refer-tint text-refer' : u === 2 ? 'bg-followup-tint text-followup' : 'bg-muted text-muted-foreground'
}

const SIGN_TEXT = new Map<string, string>()
for (const p of Object.values(PROTOCOLS)) for (const [name, s] of Object.entries(p.signs)) if (!SIGN_TEXT.has(name)) SIGN_TEXT.set(name, s.text_en)

/** Plain-language danger signs; an unknown name is shown as written rather than dropped. */
export const signText = (name: string) => SIGN_TEXT.get(name) ?? name.replace(/_/g, ' ')

export function ago(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export const firstAt = (events: { status: string; at: number }[], status: string) => events.find((e) => e.status === status)?.at ?? null
