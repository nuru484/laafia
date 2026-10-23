import type { ReferralStatus } from '@laafia/core'

export type Role = 'district_admin' | 'supervisor' | 'facility_staff'
export type Ref = { id: string; code: string; name: string }

export type User = {
  id: string; name: string; email: string | null; phone: string | null; role: Role
  facility_id: string | null; district_id: string | null; active: boolean; last_login_at: number | null; created_at: number
  facility?: Ref | null; district?: Ref | null
}

export type ReferralEvent = { id: string; referral_id: string; status: ReferralStatus; at: number; source_device_id: string; via: string }

export type Referral = {
  id: string; updated_at: number; facility_id: string | null; origin_device_id: string; short_id: string
  client_id: string | null; visit_id: string | null; client_code: string | null; client_type: 'pregnant' | 'postpartum' | 'newborn' | 'child' | null
  context: string | null; urgency: 1 | 2 | 3 | null; danger_signs: string[]; destination_facility_id: string | null; next_of_kin: string | null
  status: ReferralStatus; delivered_via: string | null; parent_referral_id: string | null; onward_referral_id: string | null; onward_status: ReferralStatus | null
  events: ReferralEvent[]
}

export type Summary = {
  district: Ref; window_days: number; total: number; by_status: Record<ReferralStatus, number>
  time_to_ack_minutes: { median: number | null; p90: number | null; count: number }; completion_rate: number | null
  per_facility: { facility: Ref & { level?: string }; referred_from: number; received: number; open: number; median_ack_minutes: number | null; completion_rate: number | null }[]
  daily: { day: string; referrals: number; completed: number }[]
}

export type Facility = { id: string; code: string; name: string; level: 'chps' | 'health_centre' | 'hospital'; phone: string | null; lat: number; lng: number; capabilities: string[]; district_id: string | null }

export type Device = {
  id: string; role: 'cho' | 'facility' | 'gateway'; user_name: string; phone_number: string | null; facility_id: string | null
  active: boolean; activated_at: number | null; facility_code: string | null; facility_name: string | null
  last_sync_at: number | null; app_version: string | null; activation_pending_until: number | null
}

export type SmsBalance = { configured: boolean; balance: number | null; currency: string | null; sms_units: number | null }
export type ApiErrorBody = { status: number; code: string; message: string; details?: { path: string; message: string }[] }

export type AuditEvent = { id: string; at: number; actor_kind: string; actor_id: string | null; actor_name: string; action: string; target_type: string; target_id: string | null; details: Record<string, unknown> }
export type SmsMessage = { id: string; at: number; to_masked: string; kind: 'ack' | 'status' | 'referral'; status: 'queued' | 'sent' | 'delivered' | 'failed'; attempts: number; error: string | null }

export type Brief = { id: string; short_id: string; client_code: string | null; urgency: number | null; status: string; destination_facility_id: string | null; made_at: number }
export type Overview = {
  today: { total: number; by_status: Record<string, number> }
  overdue_acknowledgements: Brief[]; did_not_arrive: Brief[]; completion_rate_30d: number | null; median_ack_minutes_30d: number | null
  devices_not_synced_3d: { id: string; role: string; user_name: string; facility_id: string | null; last_sync_at: number | null }[]
}

export type DuplicateClient = {
  id: string; code: string; name: string; type: string; phone: string | null; community: string; head_name: string
  facility_id: string | null; device_id: string | null; updated_at: number; visits: number; referrals: number
}
export type DuplicateGroup = { reason: 'same phone' | 'same name'; clients: DuplicateClient[] }
