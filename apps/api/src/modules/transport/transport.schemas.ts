import { z } from 'zod'

const id = z.string().min(1).max(64)

export const ProviderBody = z.object({
  id: id.optional(),
  name: z.string().min(1).max(200),
  phone: z.string().min(9).max(20),
  vehicle: z.string().max(200).default(''),
  community: z.string().max(200).default(''),
  active: z.boolean().default(true),
})
export type ProviderInput = z.infer<typeof ProviderBody>

export const ProviderPatch = ProviderBody.omit({ id: true }).partial().refine((p) => Object.keys(p).length > 0, 'nothing to change')
export type ProviderPatchInput = z.infer<typeof ProviderPatch>

export const ProviderParams = z.object({ id })

export const AdminProviderBody = ProviderBody.extend({ facility_code: z.string().max(32) })

export const RequestBody = z.object({
  id: id.optional(),
  referral_id: id,
  provider_id: id,
  scheduled_for: z.number().int().nonnegative().optional(),
})
export type RequestInput = z.infer<typeof RequestBody>
