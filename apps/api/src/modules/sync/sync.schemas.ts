import { z } from 'zod'

// --- Row contracts (docs/API.md). Unknown keys (e.g. the phone's `synced`) are stripped.

const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean)
const ms = z.number().int().nonnegative()
const id = z.string().min(1).max(64)
const str = (max = 200) => z.string().max(max)
const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? null)
const strings = z.array(str(64)).max(50).default([])
const DEVICE_ID = /^[A-Z0-9]{2,8}$/
const SHORT_ID = /^[A-Z2-7]{8}$/
const CLIENT_TYPE = z.enum(['pregnant', 'postpartum', 'newborn', 'child'])

const base = { id, updated_at: ms, device_id: opt(str(64)), deleted: bool.default(false) }

export const ROW_SCHEMAS = {
  households: z.object({
    ...base, community: str(), head_name: str(), landmark: str(500).default(''),
    lat: opt(z.number().min(-90).max(90)), lng: opt(z.number().min(-180).max(180)), consent_at: opt(ms),
  }),
  clients: z.object({
    ...base, household_id: id, code: str(32), type: CLIENT_TYPE, name: str(), sex: opt(z.enum(['f', 'm'])),
    dob: opt(z.number().int()), edd: opt(ms), delivery_date: opt(ms), parity: opt(z.number().int().min(0).max(30)),
    prior_complications: strings, birth_weight_g: opt(z.number().int().min(0).max(9000)), nhis_active: bool.default(false), risk_flags: strings,
  }),
  visits: z.object({
    ...base, client_id: id, protocol_id: str(64), visited_at: ms, answers: z.record(z.string(), z.unknown()).default({}),
    outcome: z.enum(['routine', 'followup', 'refer']), rule_id: str(64), followup_due: opt(ms), notes: opt(str(2000)), muac_mm: opt(z.number().int().min(0).max(400)),
  }),
  referrals: z.object({
    ...base, origin_device_id: z.string().regex(DEVICE_ID), short_id: z.string().regex(SHORT_ID),
    client_id: opt(id), visit_id: opt(id), client_code: opt(str(32)), client_type: opt(CLIENT_TYPE), context: opt(str(16)),
    urgency: opt(z.number().int().min(1).max(3)), danger_signs: strings, destination_facility_id: opt(id), next_of_kin: opt(str(20)),
    delivered_via: opt(z.enum(['sms', 'https'])),
    // Refer onward: the referral this one continues (set on the onward referral, fixed after creation).
    parent_referral_id: opt(id),
    // Optional proof for creating a referral pushed by a device other than its origin: the origin's signed LFR.
    lfr: opt(str(200)),
  }),
  referral_events: z.object({
    ...base, referral_id: id, origin_device_id: z.string().regex(DEVICE_ID), short_id: z.string().regex(SHORT_ID),
    status: z.enum(['created', 'sent', 'received', 'arrived', 'treated', 'closed', 'cancelled']),
    at: ms, source_device_id: str(64), via: z.enum(['sms', 'https', 'local']),
  }),
}
export type PushTable = keyof typeof ROW_SCHEMAS

export const MAX_BATCH = 200
export const PushBody = z.object({
  device_id: z.string().optional(),
  records: z.array(z.object({ table: z.string(), row: z.record(z.string(), z.unknown()) })),
})
export type PushInput = z.infer<typeof PushBody>

/*
 * Cursor: opaque string "<seq>.<base>". `seq` is the last row sent; `base` is the
 * sync_seq value when the first sync started. Rows at or below `base` form the
 * first-sync snapshot and are filtered to what the phone needs (active clients,
 * recent visits, open referrals). Rows above it are changes since and are all
 * sent. So a first sync on a poor network can stop at any page and resume.
 */
export const PullQuery = z.object({
  since: z.string().regex(/^(\d+\.\d+)?$/, 'expected the cursor from a previous pull').default(''),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
export type PullInput = z.infer<typeof PullQuery>
