import { z } from 'zod'

export const TARGET_FIELDS = ['household_ref', 'community', 'head_name', 'landmark', 'lat', 'lng', 'name', 'type', 'sex', 'dob', 'edd', 'delivery_date', 'parity', 'nhis_active', 'dhis2_uid'] as const
export type Field = (typeof TARGET_FIELDS)[number]

export const TemplateBody = z.object({
  name: z.string().min(1).max(120),
  source: z.enum(['tabular', 'dhis2']),
  mapping: z.partialRecord(z.enum(TARGET_FIELDS), z.string().min(1).max(200)),
  constants: z.partialRecord(z.enum(TARGET_FIELDS), z.string().max(200)).default({}),
})
export type TemplateInput = z.infer<typeof TemplateBody>

export const PreviewFields = z.object({ template_id: z.uuid(), facility_code: z.string().max(32) })

export const Dhis2Body = z.object({
  template_id: z.uuid(),
  facility_code: z.string().max(32),
  org_unit: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  program: z.string().regex(/^[A-Za-z0-9]{11}$/).optional(),
  tracked_entity_type: z.string().regex(/^[A-Za-z0-9]{11}$/).optional(),
  max_pages: z.number().int().min(1).max(100).default(50),
})
export type Dhis2Input = z.infer<typeof Dhis2Body>

export const BatchListQuery = z.object({ facility: z.string().max(32).optional() })
export const BatchParams = z.object({ id: z.uuid() })
// Reads are lenient: anything that is not a UUID is an unknown batch (404), as before.
export const BatchReadParams = z.object({ id: z.string() })

/** A normalised register row as stored on a preview batch (wire keys, kept inside a JSON column). */
export type ImportRow = {
  row: number
  household: { key: string; community: string; head_name: string; landmark: string; lat: number | null; lng: number | null }
  client: { name: string; type: string; sex: 'f' | 'm' | null; dob: number | null; edd: number | null; delivery_date: number | null; parity: number | null; nhis_active: boolean; dhis2_uid: string | null }
}
export type ImportIssue = { row: number; kind: 'error' | 'duplicate'; field?: string; message: string; match_id?: string }
