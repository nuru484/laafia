import type { AuditEvent, Device, Facility, Overview, Referral, SmsBalance, SmsMessage, Summary, User, DuplicateGroup } from '@/types/api'
import { api } from './api'

export const endpoints = api.injectEndpoints({
  endpoints: (b) => ({
    me: b.query<{ user: User }, void>({ query: () => '/web/me', providesTags: ['Me'] }),
    login: b.mutation<{ user: User; csrf_token: string }, { login: string; password: string }>({ query: (body) => ({ url: '/web/login', method: 'POST', body }), invalidatesTags: ['Me'] }),
    logout: b.mutation<{ ok: true }, void>({ query: () => ({ url: '/web/logout', method: 'POST' }) }),
    updateMe: b.mutation<{ user: User }, { name?: string; email?: string | null; phone?: string | null }>({ query: (body) => ({ url: '/web/me', method: 'PATCH', body }), invalidatesTags: ['Me', 'User'] }),
    duplicates: b.query<{ groups: DuplicateGroup[] }, void>({ query: () => '/admin/clients/duplicates', providesTags: ['Duplicate'] }),
    mergeClient: b.mutation<{ kept: string; moved: { visits: number; referrals: number } }, { id: string; into: string }>({
      query: ({ id, into }) => ({ url: `/admin/clients/${id}/merge`, method: 'POST', body: { into } }), invalidatesTags: ['Duplicate', 'Referral', 'Audit'],
    }),
    changeMyPassword: b.mutation<{ ok: true }, { current_password: string; new_password: string }>({ query: (body) => ({ url: '/web/me/password', method: 'POST', body }) }),

    overview: b.query<Overview, void>({ query: () => '/dashboard/overview', providesTags: ['Summary'] }),
    summary: b.query<Summary, number>({ query: (days) => `/dashboard/summary?days=${days}`, providesTags: ['Summary'] }),
    referrals: b.query<{ referrals: Referral[] }, { facility?: string; status?: string; urgency?: string }>({
      query: (q) => ({ url: '/referrals', params: Object.fromEntries(Object.entries(q).filter(([, v]) => v)) }),
      providesTags: ['Referral'],
    }),
    referral: b.query<{ referral: Referral; chain?: Referral[] }, string>({ query: (id) => `/referrals/${id}`, providesTags: (_r, _e, id) => [{ type: 'Referral', id }] }),
    referralClient: b.query<{ client: Record<string, unknown> | null; household?: Record<string, unknown> | null }, string>({ query: (id) => `/referrals/${id}/client` }),
    setStatus: b.mutation<unknown, { id: string; status: 'received' | 'arrived' | 'treated' | 'closed' }>({
      query: ({ id, status }) => ({ url: `/referrals/${id}/status`, method: 'POST', body: { status } }),
      invalidatesTags: ['Referral', 'Summary'],
    }),
    onward: b.mutation<{ referral: Referral }, { id: string; destination_facility_code: string; urgency?: number }>({
      query: ({ id, ...body }) => ({ url: `/referrals/${id}/onward`, method: 'POST', body }),
      invalidatesTags: ['Referral', 'Summary'],
    }),

    facilities: b.query<{ facilities: Facility[] }, void>({ query: () => '/admin/facilities', providesTags: ['Facility'] }),
    createFacility: b.mutation<unknown, Partial<Facility>>({ query: (body) => ({ url: '/admin/facilities', method: 'POST', body }), invalidatesTags: ['Facility'] }),
    updateFacility: b.mutation<unknown, Partial<Facility> & { id: string }>({ query: ({ id, ...body }) => ({ url: `/admin/facilities/${id}`, method: 'PATCH', body }), invalidatesTags: ['Facility'] }),

    users: b.query<{ users: User[] }, void>({ query: () => '/admin/users', providesTags: ['User'] }),
    createUser: b.mutation<{ user: User }, { name: string; email?: string; phone?: string; password: string; role: string; facility_code?: string }>({
      query: (body) => ({ url: '/admin/users', method: 'POST', body }), invalidatesTags: ['User'],
    }),
    updateUser: b.mutation<{ user: User }, { id: string; name?: string; email?: string | null; phone?: string | null }>({ query: ({ id, ...body }) => ({ url: `/admin/users/${id}`, method: 'PATCH', body }), invalidatesTags: ['User'] }),
    setUserPassword: b.mutation<unknown, { id: string; password: string }>({ query: ({ id, password }) => ({ url: `/admin/users/${id}/password`, method: 'POST', body: { password } }) }),
    setUserActive: b.mutation<unknown, { id: string; active: boolean }>({ query: ({ id, active }) => ({ url: `/admin/users/${id}/${active ? 'activate' : 'deactivate'}`, method: 'POST' }), invalidatesTags: ['User'] }),

    devices: b.query<{ devices: Device[] }, void>({ query: () => '/admin/devices', providesTags: ['Device'] }),
    createDevice: b.mutation<{ device: Device; activation_code: string; expires_at: number }, { role: string; user_name: string; facility_code: string; phone_number?: string }>({
      query: (body) => ({ url: '/admin/devices', method: 'POST', body }), invalidatesTags: ['Device'],
    }),
    updateDevice: b.mutation<{ device: Device }, { id: string; user_name?: string; phone_number?: string | null; facility_code?: string }>({ query: ({ id, ...body }) => ({ url: `/admin/devices/${id}`, method: 'PATCH', body }), invalidatesTags: ['Device'] }),
    reissueCode: b.mutation<{ device: Device; activation_code: string; expires_at: number }, string>({ query: (id) => ({ url: `/admin/devices/${id}/code`, method: 'POST' }), invalidatesTags: ['Device'] }),
    deactivateDevice: b.mutation<unknown, string>({ query: (id) => ({ url: `/admin/devices/${id}/deactivate`, method: 'POST' }), invalidatesTags: ['Device'] }),

    audit: b.query<{ events: AuditEvent[]; next_before: number | null }, { before?: number; target_type?: string }>({
      query: (q) => ({ url: '/admin/audit', params: { limit: 50, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) } }),
      providesTags: ['Audit'],
    }),
    smsBalance: b.query<SmsBalance, void>({ query: () => '/admin/sms/balance', providesTags: ['Sms'] }),
    smsLog: b.query<{ messages: SmsMessage[]; next_before: number | null }, { before?: number }>({ query: (q) => ({ url: '/admin/sms/log', params: { limit: 50, ...(q.before ? { before: q.before } : {}) } }), providesTags: ['Sms'] }),
  }),
})

export const {
  useMeQuery, useLoginMutation, useLogoutMutation, useDuplicatesQuery, useMergeClientMutation, useUpdateMeMutation, useChangeMyPasswordMutation, useOverviewQuery, useSummaryQuery, useReferralsQuery, useReferralQuery, useReferralClientQuery,
  useSetStatusMutation, useOnwardMutation, useFacilitiesQuery, useCreateFacilityMutation, useUpdateFacilityMutation,
  useUsersQuery, useCreateUserMutation, useUpdateUserMutation, useSetUserPasswordMutation, useSetUserActiveMutation, useDevicesQuery, useCreateDeviceMutation,
  useReissueCodeMutation, useDeactivateDeviceMutation, useUpdateDeviceMutation, useAuditQuery, useSmsBalanceQuery, useSmsLogQuery,
} = endpoints
