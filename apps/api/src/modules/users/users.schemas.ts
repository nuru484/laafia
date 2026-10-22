import { z } from 'zod'

export const USER_ROLES = ['district_admin', 'facility_staff', 'supervisor'] as const

export const LoginBody = z.object({ login: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) })

const password = z.string().min(10, 'at least 10 characters').max(200)

export const CreateUserBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(200).optional(),
    phone: z.string().min(9).max(20).optional(),
    password,
    role: z.enum(USER_ROLES),
    facility_code: z.string().max(32).optional(),
    district_code: z.string().max(16).optional(),
  })
  .refine((u) => u.email || u.phone, { message: 'email or phone is required', path: ['email'] })
  .refine((u) => u.role !== 'facility_staff' || u.facility_code, { message: 'facility staff need a facility_code', path: ['facility_code'] })
export type CreateUserInput = z.infer<typeof CreateUserBody>

export const UpdateUserBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    email: z.email().max(200).nullable().optional(),
    phone: z.string().min(9).max(20).nullable().optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: 'nothing to change' })
export type UpdateUserInput = z.infer<typeof UpdateUserBody>

export const PasswordBody = z.object({ password })
export const UserParams = z.object({ id: z.string().max(64) })
