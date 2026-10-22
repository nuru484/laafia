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

export const MatrixQuery = z.object({
  langs: z.string().regex(/^[a-z]{2,3}(,[a-z]{2,3})*$/).optional().transform((v) => v?.split(',')),
})

export const DistrictParams = z.object({ district: z.string().max(16) })

const lng = z.number().min(-180).max(180)
const lat = z.number().min(-85).max(85)
/** About 165 km a side; a Northern Region district fits with room, and the extract stays small enough for a phone. */
export const MAX_MAP_SPAN = 1.5
export const BuildBody = z.object({
  bbox: z.tuple([lng, lat, lng, lat]).refine(([w, s, e, n]) => w < e && s < n, 'west must be less than east and south less than north')
    .refine(([w, s, e, n]) => e - w <= MAX_MAP_SPAN && n - s <= MAX_MAP_SPAN, `at most ${MAX_MAP_SPAN} degrees a side`),
})
export type BuildBody = z.infer<typeof BuildBody>
