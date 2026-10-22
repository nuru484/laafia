import { z } from 'zod'

export const CreateDeviceBody = z.object({
  id: z.string().regex(/^[A-Z0-9]{2,8}$/).optional(),
  role: z.enum(['cho', 'volunteer', 'facility']),
  user_name: z.string().min(1).max(200),
  phone_number: z.string().max(20).optional(),
  facility_code: z.string().max(32),
})
export type CreateDeviceInput = z.infer<typeof CreateDeviceBody>

export const DeviceParams = z.object({ id: z.string().max(64) })
