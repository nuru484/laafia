import { z } from 'zod'
import { WEB_STATUSES } from './referrals.service.ts'

export const FacilityQuery = z.object({ facility: z.string().min(1).max(32) })
export const ListQuery = z.object({
  facility: z.string().min(1).max(32).optional(),
  status: z.enum(['created', 'carrying', 'sent', 'received', 'arrived', 'treated', 'closed', 'cancelled']).optional(),
  urgency: z.coerce.number().int().min(1).max(3).optional(),
})
export const IdParams = z.object({ id: z.string().max(64) })
export const StatusBody = z.object({ status: z.enum(WEB_STATUSES) })
export const OnwardBody = z.object({ destination_facility_code: z.string().max(32), urgency: z.number().int().min(1).max(3).optional() })
export const TransportBody = z.object({ provider_id: z.string().max(64), scheduled_for: z.number().int().nonnegative().optional() })
