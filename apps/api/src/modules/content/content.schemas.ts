import { z } from 'zod'

export const UploadFields = z.object({
  kind: z.enum(['audio', 'tiles']),
  language: z.string().regex(/^[a-z]{2,3}$/).optional(),
  district_code: z.string().max(16).optional(),
  version: z.coerce.number().int().positive().optional(),
})
export type UploadFields = z.infer<typeof UploadFields>

// Lenient: anything that is not a UUID is simply an unknown pack (404).
export const PackParams = z.object({ id: z.string() }).transform(({ id }) => ({ id: z.uuid().safeParse(id).success ? id : undefined }))
