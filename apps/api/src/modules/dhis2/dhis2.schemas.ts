import { z } from 'zod'

export const ExportQuery = z.object({ facility: z.string().min(1).max(32), period: z.string().max(6) })
export const PushBody = z.object({ facility: z.string().min(1).max(32), period: z.string().max(6), dry_run: z.boolean().default(true) })
export const HistoryQuery = z.object({ facility: z.string().min(1).max(32), limit: z.coerce.number().int().min(1).max(200).default(50) })
export const PendingQuery = z.object({ facility: z.string().min(1).max(32), months: z.coerce.number().int().min(1).max(24).default(12) })
