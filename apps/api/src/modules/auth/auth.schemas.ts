import { z } from 'zod'

export const ActivateBody = z.object({
  activation_code: z.string().regex(/^\d{8}$/),
  phone_number: z.string().min(9).max(20),
  device_info: z.record(z.string(), z.unknown()).optional(),
})
export type ActivateInput = z.infer<typeof ActivateBody>
