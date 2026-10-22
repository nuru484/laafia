import { z } from 'zod'

export const CreateDeviceBody = z.object({
  id: z.string().regex(/^[A-Z0-9]{2,8}$/).optional(),
  role: z.enum(['cho', 'facility']),
  user_name: z.string().min(1).max(200),
  phone_number: z.string().max(20).optional(),
  facility_code: z.string().max(32),
})
export type CreateDeviceInput = z.infer<typeof CreateDeviceBody>

export const UpdateDeviceBody = z
  .object({
    user_name: z.string().trim().min(1).max(200).optional(),
    phone_number: z.string().min(9).max(20).nullable().optional(),
    facility_code: z.string().max(32).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'nothing to change' })
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceBody>

export const DeviceParams = z.object({ id: z.string().max(64) })
