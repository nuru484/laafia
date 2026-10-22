import { z } from 'zod'

export const TicketBody = z.object({ facility: z.string().min(1).max(32) })
// Lenient on purpose: a missing or malformed ticket is a 401 invalid_ticket, not a 400.
export const StreamQuery = z.object({ ticket: z.string().max(64).optional() }).catch({ ticket: undefined })
