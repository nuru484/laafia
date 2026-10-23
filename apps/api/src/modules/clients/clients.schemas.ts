import { z } from 'zod'

export const ClientParams = z.object({ id: z.string().min(1).max(64) })
export const MergeBody = z.object({ into: z.string().min(1).max(64) })
