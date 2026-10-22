// Shared record shapes (spec section 5). snake_case matches the database columns and the sync JSON.

export type ClientType = 'pregnant' | 'postpartum' | 'newborn' | 'child'
export type ClientWireType = 'PW' | 'PP' | 'NB' | 'CH'

export const WIRE_TYPE: Record<ClientType, ClientWireType> = {
  pregnant: 'PW',
  postpartum: 'PP',
  newborn: 'NB',
  child: 'CH',
}

export type Outcome = 'routine' | 'followup' | 'refer'

export type ReferralStatus = 'created' | 'carrying' | 'sent' | 'received' | 'arrived' | 'treated' | 'closed' | 'cancelled'

export type FacilityLevel = 'chps' | 'health_centre' | 'hospital'

export type Facility = {
  id: string
  code: string
  name: string
  level: FacilityLevel
  phone: string | null
  lat: number
  lng: number
  capabilities: string[]
}

export type Household = {
  id: string
  community: string
  head_name: string
  landmark: string
  lat: number | null
  lng: number | null
  consent_at: number | null
}

export type Client = {
  id: string
  household_id: string
  code: string
  type: ClientType
  name: string
  sex: 'f' | 'm' | null
  dob: number | null
  edd: number | null
  delivery_date: number | null
  parity: number | null
  prior_complications: string[]
  birth_weight_g: number | null
  nhis_active: boolean
}

export type Visit = {
  id: string
  client_id: string
  protocol_id: string
  visited_at: number
  answers: Record<string, unknown>
  outcome: Outcome
  rule_id: string
  followup_due: number | null
  muac_mm: number | null
}

export type ReferralEvent = {
  id: string
  referral_id: string
  status: ReferralStatus
  at: number
  source_device_id: string
  via: 'sms' | 'qr' | 'https' | 'local'
}
