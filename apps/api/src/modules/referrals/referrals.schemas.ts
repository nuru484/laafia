import { z } from 'zod'
import { WEB_STATUSES } from './referrals.service.ts'

export const FacilityQuery = z.object({ facility: z.string().min(1).max(32) })
export const IdParams = z.object({ id: z.string().max(64) })
export const StatusBody = z.object({ status: z.enum(WEB_STATUSES) })
