import type { ReferralStatus } from '@laafia/core'

export type Role = 'district_admin' | 'supervisor' | 'facility_staff'
export type Ref = { id: string; code: string; name: string }

export type User = {
  id: string; name: string; email: string | null; phone: string | null; role: Role
  facility_id: string | null; district_id: string | null; active: boolean; last_login_at: number | null; created_at: number
  facility?: Ref | null; district?: Ref | null
}

export type ReferralEvent = { id: string; referral_id: string; status: ReferralStatus; at: number; source_device_id: string; via: string }
export type Transport = { id: string; provider_id: string; provider_name: string | null; provider_phone: string | null; status: string; scheduled_for: number | null; updated_at: number }

export type Referral = {
  id: string; updated_at: number; facility_id: string | null; origin_device_id: string; short_id: string
  client_id: string | null; visit_id: string | null; client_code: string | null; client_type: 'pregnant' | 'postpartum' | 'newborn' | 'child' | null
  context: string | null; urgency: 1 | 2 | 3 | null; danger_signs: string[]; destination_facility_id: string | null; next_of_kin: string | null
  status: ReferralStatus; delivered_via: string | null; parent_referral_id: string | null; onward_referral_id: string | null; onward_status: ReferralStatus | null
  events: ReferralEvent[]; transport: Transport[]
}

export type Summary = {
  district: Ref; window_days: number; total: number; by_status: Record<ReferralStatus, number>
  time_to_ack_minutes: { median: number | null; p90: number | null; count: number }; completion_rate: number | null
  per_facility: { facility: Ref & { level?: string }; referred_from: number; received: number; open: number; median_ack_minutes: number | null; completion_rate: number | null }[]
  daily: { day: string; referrals: number; completed: number }[]
}

export type Facility = { id: string; code: string; name: string; level: 'chps' | 'health_centre' | 'hospital'; phone: string | null; lat: number; lng: number; capabilities: string[]; languages: string[]; district_id: string | null }

export type Device = {
  id: string; role: 'cho' | 'volunteer' | 'facility' | 'gateway'; user_name: string; phone_number: string | null; facility_id: string | null
  active: boolean; activated_at: number | null; facility_code: string | null; facility_name: string | null
  last_sync_at: number | null; app_version: string | null; activation_pending_until: number | null
}

export type Provider = { id: string; facility_id: string | null; facility_code: string | null; name: string; phone: string; vehicle: string; community: string; active: boolean }

export type Pack = { id: string; kind: 'audio' | 'tiles'; language: string | null; district_code: string | null; version: number; size: number; sha256: string; content_type: string; url: string; created_at: number }
export type Clip = { id: string; prompt_id: string; lang: string; sha256: string; size: number; recorded_at: number; url: string; device_id?: string | null }

export type ApiErrorBody = { status: number; code: string; message: string; details?: { path: string; message: string }[] }
