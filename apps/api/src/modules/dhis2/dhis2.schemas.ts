import { z } from 'zod'

export const ExportQuery = z.object({ facility: z.string().min(1).max(32), period: z.string().max(6) })
export const PushBody = z.object({ facility: z.string().min(1).max(32), period: z.string().max(6), dry_run: z.boolean().default(true) })
