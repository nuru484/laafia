import { z } from 'zod'

/** Map tiles only; audio travels as individual clips (POST /content/clips). */
export const UploadFields = z.object({
  kind: z.literal('tiles'),
  district_code: z.string().max(16),
  version: z.coerce.number().int().positive().optional(),
})
export type UploadFields = z.infer<typeof UploadFields>

// Lenient: anything that is not a UUID is simply an unknown pack (404).
export const PackParams = z.object({ id: z.string() }).transform(({ id }) => ({ id: z.uuid().safeParse(id).success ? id : undefined }))

export const ClipFields = z.object({
  prompt_id: z.string().regex(/^[a-z0-9_]{1,64}$/),
  lang: z.string().regex(/^[a-z]{2,3}$/),
})
export type ClipFields = z.infer<typeof ClipFields>

export const ClipQuery = z.object({ lang: z.string().regex(/^[a-z]{2,3}$/).optional() })
export const ClipParams = z.object({ id: z.string().max(64) })
