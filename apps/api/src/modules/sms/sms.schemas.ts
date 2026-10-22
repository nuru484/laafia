import { z } from 'zod'

/**
 * Generic inbound SMS: { from, text } (or { sender, message }), JSON or form-encoded.
 * Frog has no inbound (mobile-originated) delivery that the house integration
 * uses, so this stays provider-neutral for any number that forwards SMS here.
 */
export const InboundBody = z
  .object({ from: z.string().optional(), sender: z.string().optional(), text: z.string().optional(), message: z.string().optional() })
  .transform((b) => ({ from: b.from ?? b.sender, text: b.text ?? b.message }))

export const FROG_STATUSES = ['DELETED', 'UNKNOWN', 'EXPIRED', 'WAITING', 'FAILED', 'REJECTD', 'UNDELIV', 'ACCEPTD', 'DELIVRD', 'BUSY', 'ANSWERED'] as const

/** One Frog delivery receipt (same shape as dms-backend). Validated per item so one bad receipt never sinks a batch. */
export const FrogReceipt = z.object({
  msgid: z.string().min(1).max(64),
  status: z.enum(FROG_STATUSES),
  reason: z.string().max(200).optional(),
  destination: z.string().max(20).optional(),
  statusdate: z.string().max(40).optional(),
})
export type FrogReceipt = z.infer<typeof FrogReceipt>

export const LogQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
})

/** Frog posts receipts as a JSON array or as an object keyed by index. */
export const receiptItems = (body: unknown): unknown[] => (Array.isArray(body) ? body : body && typeof body === 'object' ? Object.values(body) : [])
