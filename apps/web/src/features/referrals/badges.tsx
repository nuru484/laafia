import type { ReferralStatus } from '@laafia/core'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, statusTone, urgencyTone } from './labels'

export function StatusBadge({ status }: { status: ReferralStatus }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', statusTone(status))}>{STATUS_LABEL[status]}</span>
}

export function UrgencyBadge({ urgency }: { urgency: number | null }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', urgencyTone(urgency))}>{urgency === 3 ? 'Emergency' : urgency === 2 ? 'Urgent' : 'Routine'}</span>
}
