import { z } from 'zod'

const fields = {
  name: z.string().trim().min(1).max(200),
  level: z.enum(['chps', 'health_centre', 'hospital']),
  phone: z.string().min(9).max(20).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  capabilities: z.array(z.string().regex(/^[a-z0-9_]{1,32}$/)).max(20).default([]),
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(10).default([]),
}

export const CreateFacilityBody = z.object({
  code: z.string().regex(/^[A-Z0-9-]{3,16}$/, 'like SAV-CHPS-02'),
  ...fields,
  district_code: z.string().max(16).optional(),
})
export type CreateFacilityInput = z.infer<typeof CreateFacilityBody>

export const UpdateFacilityBody = z.object(fields).partial().refine((p) => Object.keys(p).length > 0, 'nothing to change')
export type UpdateFacilityInput = z.infer<typeof UpdateFacilityBody>

export const FacilityParams = z.object({ id: z.string().max(64) })
