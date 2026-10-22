import { z } from 'zod'

/** Arkesel posts { from, text }; some gateways use { sender, message }. JSON or form-encoded. */
export const InboundBody = z
  .object({ from: z.string().optional(), sender: z.string().optional(), text: z.string().optional(), message: z.string().optional() })
  .transform((b) => ({ from: b.from ?? b.sender, text: b.text ?? b.message }))
