import { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

/*
 * Server tables (spec section 5). Column names are the sync JSON keys, so a
 * validated row inserts as-is. Every synced table carries `seq`, set from the
 * global `sync_seq` by a trigger on every insert and update (migration 0001);
 * /sync/pull pages on it instead of phone clocks. `facility_id` is the
 * catchment the row belongs to, stamped by the server from the pushing device.
 */

const ms = (name: string) => bigint(name, { mode: 'number' })

const sync = {
  id: text('id').primaryKey(),
  updated_at: ms('updated_at').notNull(),
  device_id: text('device_id'),
  deleted: boolean('deleted').notNull().default(false),
  seq: ms('seq').notNull().default(0),
}

export const facilities = pgTable('facilities', {
  ...sync,
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  level: text('level', { enum: ['chps', 'health_centre', 'hospital'] }).notNull(),
  phone: text('phone'),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
}, (t) => [index('facilities_seq').on(t.seq)])

// key_hex is the raw HMAC key: the server must verify inbound SMS and hand keys to facility phones, so a hash would not do.
export const devices = pgTable('devices', {
  ...sync,
  role: text('role', { enum: ['cho', 'volunteer', 'facility', 'gateway'] }).notNull(),
  user_name: text('user_name').notNull(),
  phone_number: text('phone_number'),
  facility_id: text('facility_id').references(() => facilities.id),
  key_hex: text('key_hex'),
  active: boolean('active').notNull().default(true),
  activated_at: ms('activated_at'),
}, (t) => [index('devices_seq').on(t.seq)])

export const activation_codes = pgTable('activation_codes', {
  code: text('code').primaryKey(),
  device_id: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  expires_at: ms('expires_at').notNull(),
  used_at: ms('used_at'),
}, (t) => [index('activation_codes_device').on(t.device_id)])

export const households = pgTable('households', {
  ...sync,
  facility_id: text('facility_id'),
  community: text('community').notNull(),
  head_name: text('head_name').notNull(),
  landmark: text('landmark').notNull().default(''),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  consent_at: ms('consent_at'),
}, (t) => [index('households_scope').on(t.facility_id, t.seq)])

export const clients = pgTable('clients', {
  ...sync,
  facility_id: text('facility_id'),
  household_id: text('household_id').notNull(),
  code: text('code').notNull(),
  type: text('type', { enum: ['pregnant', 'postpartum', 'newborn', 'child'] }).notNull(),
  name: text('name').notNull(),
  sex: text('sex', { enum: ['f', 'm'] }),
  dob: ms('dob'),
  edd: ms('edd'),
  delivery_date: ms('delivery_date'),
  parity: integer('parity'),
  prior_complications: jsonb('prior_complications').$type<string[]>().notNull().default([]),
  birth_weight_g: integer('birth_weight_g'),
  nhis_active: boolean('nhis_active').notNull().default(false),
  risk_flags: jsonb('risk_flags').$type<string[]>().notNull().default([]),
}, (t) => [index('clients_scope').on(t.facility_id, t.seq), index('clients_household').on(t.household_id)])

export const visits = pgTable('visits', {
  ...sync,
  facility_id: text('facility_id'),
  client_id: text('client_id').notNull(),
  protocol_id: text('protocol_id').notNull(),
  visited_at: ms('visited_at').notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  outcome: text('outcome', { enum: ['routine', 'followup', 'refer'] }).notNull(),
  rule_id: text('rule_id').notNull(),
  followup_due: ms('followup_due'),
  notes: text('notes'),
  muac_mm: integer('muac_mm'),
}, (t) => [index('visits_scope').on(t.facility_id, t.seq), index('visits_client').on(t.client_id, t.visited_at)])

/*
 * A referral's identity is (origin_device_id, short_id). The server may learn
 * of it from an SMS before the phone pushes its UUID; it then holds a server
 * id that is re-keyed to the origin phone's id when that push arrives.
 * `status` is derived from referral_events, never taken from a push.
 */
export const referrals = pgTable('referrals', {
  ...sync,
  facility_id: text('facility_id'),
  origin_device_id: text('origin_device_id').notNull(),
  short_id: text('short_id').notNull(),
  client_id: text('client_id'),
  visit_id: text('visit_id'),
  client_code: text('client_code'),
  client_type: text('client_type', { enum: ['pregnant', 'postpartum', 'newborn', 'child'] }),
  context: text('context'),
  urgency: integer('urgency'),
  danger_signs: jsonb('danger_signs').$type<string[]>().notNull().default([]),
  destination_facility_id: text('destination_facility_id'),
  next_of_kin: text('next_of_kin'),
  status: text('status').notNull().default('created'),
  delivered_via: text('delivered_via', { enum: ['sms', 'qr', 'https'] }),
}, (t) => [
  uniqueIndex('referrals_key').on(t.origin_device_id, t.short_id),
  index('referrals_scope').on(t.facility_id, t.seq),
  index('referrals_dest').on(t.destination_facility_id, t.seq),
])

export const referral_events = pgTable('referral_events', {
  ...sync,
  referral_id: text('referral_id').notNull().references(() => referrals.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  status: text('status', { enum: ['created', 'carrying', 'sent', 'received', 'arrived', 'treated', 'closed', 'cancelled'] }).notNull(),
  at: ms('at').notNull(),
  source_device_id: text('source_device_id').notNull(),
  via: text('via', { enum: ['sms', 'qr', 'https', 'local'] }).notNull(),
}, (t) => [index('referral_events_referral').on(t.referral_id), index('referral_events_seq').on(t.seq)])

export const transport_providers = pgTable('transport_providers', {
  ...sync,
  facility_id: text('facility_id'),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  vehicle: text('vehicle').notNull().default(''),
  community: text('community').notNull().default(''),
  active: boolean('active').notNull().default(true),
}, (t) => [index('transport_providers_scope').on(t.facility_id, t.seq), index('transport_providers_phone').on(t.phone)])

export const transport_requests = pgTable('transport_requests', {
  ...sync,
  facility_id: text('facility_id'),
  referral_id: text('referral_id'),
  provider_id: text('provider_id').notNull(),
  status: text('status', { enum: ['requested', 'coming', 'declined', 'done'] }).notNull(),
  scheduled_for: ms('scheduled_for'),
}, (t) => [index('transport_requests_scope').on(t.facility_id, t.seq), index('transport_requests_provider').on(t.provider_id, t.status)])

/** Outgoing gateway SMS with retry and backoff (spec 16.5). */
export const jobs = pgTable('jobs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  kind: text('kind', { enum: ['sms'] }).notNull(),
  payload: jsonb('payload').$type<{ to: string; body: string }>().notNull(),
  status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  run_at: ms('run_at').notNull(),
  last_error: text('last_error'),
  created_at: ms('created_at').notNull(),
}, (t) => [index('jobs_due').on(t.status, t.run_at)])

export const SYNCED = { facilities, devices, households, clients, visits, referrals, referral_events, transport_providers, transport_requests }
