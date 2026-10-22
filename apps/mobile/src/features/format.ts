import type { ReferralStatus } from '@laafia/core'
import { color } from '../ui/theme'

export const TYPE_NAME: Record<string, string> = { pregnant: 'Pregnant', postpartum: 'After delivery', newborn: 'Newborn', child: 'Child' }

export const STATUS_TEXT: Record<ReferralStatus, string> = {
  created: 'Not sent yet', sent: 'Sent, waiting for the facility', received: 'Facility received it',
  arrived: 'Arrived at the facility', treated: 'Treated', closed: 'Closed, follow-up scheduled', cancelled: 'Cancelled',
}

export function statusTone(s: ReferralStatus): { fg: string; bg: string } {
  if (s === 'created' || s === 'sent') return { fg: color.followup, bg: color.followupBg }
  if (s === 'cancelled') return { fg: color.muted, bg: color.line }
  return { fg: color.routine, bg: color.routineBg }
}

export function outcomeTone(o: string): { fg: string; bg: string; label: string } {
  if (o === 'refer') return { fg: color.refer, bg: color.referBg, label: 'Refer now' }
  if (o === 'followup') return { fg: color.followup, bg: color.followupBg, label: 'Follow up' }
  return { fg: color.routine, bg: color.routineBg, label: 'Routine' }
}

export function ago(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function ageText(dob: number | null, now = Date.now()): string {
  if (dob === null) return ''
  const days = Math.floor((now - dob) / 86_400_000)
  if (days < 60) return `${days} days old`
  const months = Math.floor(days / 30.4)
  return months < 24 ? `${months} months old` : `${Math.floor(months / 12)} years old`
}
