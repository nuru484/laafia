import type { AuditEvent, Clip, Device, SmsMessage, ExportPreview, ExportRecord, ExportResult, Facility, ImportBatch, ImportTemplate, Pack, Provider, Referral, Summary, User } from '@/types/api'
import { api } from './api'

export const endpoints = api.injectEndpoints({
  endpoints: (b) => ({
    me: b.query<{ user: User }, void>({ query: () => '/web/me', providesTags: ['Me'] }),
    login: b.mutation<{ user: User; csrf_token: string }, { login: string; password: string }>({ query: (body) => ({ url: '/web/login', method: 'POST', body }), invalidatesTags: ['Me'] }),
    logout: b.mutation<{ ok: true }, void>({ query: () => ({ url: '/web/logout', method: 'POST' }) }),

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
    setUserPassword: b.mutation<unknown, { id: string; password: string }>({ query: ({ id, password }) => ({ url: `/admin/users/${id}/password`, method: 'POST', body: { password } }) }),
    setUserActive: b.mutation<unknown, { id: string; active: boolean }>({ query: ({ id, active }) => ({ url: `/admin/users/${id}/${active ? 'activate' : 'deactivate'}`, method: 'POST' }), invalidatesTags: ['User'] }),

    devices: b.query<{ devices: Device[] }, void>({ query: () => '/admin/devices', providesTags: ['Device'] }),
    createDevice: b.mutation<{ device: Device; activation_code: string; expires_at: number }, { role: string; user_name: string; facility_code: string; phone_number?: string }>({
      query: (body) => ({ url: '/admin/devices', method: 'POST', body }), invalidatesTags: ['Device'],
    }),
    reissueCode: b.mutation<{ device: Device; activation_code: string; expires_at: number }, string>({ query: (id) => ({ url: `/admin/devices/${id}/code`, method: 'POST' }), invalidatesTags: ['Device'] }),
    deactivateDevice: b.mutation<unknown, string>({ query: (id) => ({ url: `/admin/devices/${id}/deactivate`, method: 'POST' }), invalidatesTags: ['Device'] }),

    providers: b.query<{ providers: Provider[] }, void>({ query: () => '/admin/transport/providers', providesTags: ['Provider'] }),
    createProvider: b.mutation<unknown, { facility_code: string; name: string; phone: string; vehicle: string; community: string }>({
      query: (body) => ({ url: '/admin/transport/providers', method: 'POST', body }), invalidatesTags: ['Provider'],
    }),
    updateProvider: b.mutation<unknown, Partial<Provider> & { id: string }>({ query: ({ id, ...body }) => ({ url: `/admin/transport/providers/${id}`, method: 'PATCH', body }), invalidatesTags: ['Provider'] }),

    templates: b.query<{ templates: ImportTemplate[] }, void>({ query: () => '/admin/import/templates', providesTags: ['Import'] }),
    createTemplate: b.mutation<{ template: ImportTemplate }, Omit<ImportTemplate, 'id' | 'created_at'>>({ query: (body) => ({ url: '/admin/import/templates', method: 'POST', body }), invalidatesTags: ['Import'] }),
    previewUpload: b.mutation<{ batch: ImportBatch }, FormData>({ query: (body) => ({ url: '/admin/import/preview', method: 'POST', body }), invalidatesTags: ['Import'] }),
    previewDhis2: b.mutation<{ batch: ImportBatch }, { template_id: string; facility_code: string; org_unit: string; program?: string }>({ query: (body) => ({ url: '/admin/import/dhis2/preview', method: 'POST', body }), invalidatesTags: ['Import'] }),
    batches: b.query<{ batches: ImportBatch[] }, void>({ query: () => '/admin/import/batches', providesTags: ['Import'] }),
    commitBatch: b.mutation<{ batch: ImportBatch }, string>({ query: (id) => ({ url: `/admin/import/batches/${id}/commit`, method: 'POST' }), invalidatesTags: ['Import'] }),
    undoBatch: b.mutation<{ batch: ImportBatch; undone: { clients: number; households: number }; kept: { clients: number; households: number } }, string>({ query: (id) => ({ url: `/admin/import/batches/${id}/undo`, method: 'POST' }), invalidatesTags: ['Import'] }),

    exportPreview: b.query<ExportPreview, { facility: string; period: string }>({ query: (q) => ({ url: '/export/dhis2', params: q }) }),
    exportPush: b.mutation<ExportResult, { facility: string; period: string; dry_run: boolean }>({ query: (body) => ({ url: '/export/dhis2', method: 'POST', body }), invalidatesTags: ['Export'] }),
    exportHistory: b.query<{ exports: ExportRecord[]; pending_periods: string[] }, string>({ query: (facility) => ({ url: '/export/dhis2/history', params: { facility, limit: 20 } }), providesTags: ['Export'] }),

    audit: b.query<{ events: AuditEvent[]; next_before: number | null }, { before?: number; target_type?: string }>({
      query: (q) => ({ url: '/admin/audit', params: { limit: 50, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) } }),
      providesTags: ['Audit'],
    }),
    smsBalance: b.query<{ configured: boolean; balance: number | null; currency: string | null }, void>({ query: () => '/admin/sms/balance', providesTags: ['Sms'] }),
    smsLog: b.query<{ messages: SmsMessage[]; next_before: number | null }, { before?: number }>({ query: (q) => ({ url: '/admin/sms/log', params: { limit: 50, ...(q.before ? { before: q.before } : {}) } }), providesTags: ['Sms'] }),

    packs: b.query<{ packs: Pack[] }, void>({ query: () => '/admin/content/packs', providesTags: ['Pack'] }),
    uploadPack: b.mutation<{ pack: Pack }, FormData>({ query: (body) => ({ url: '/admin/content/packs', method: 'POST', body }), invalidatesTags: ['Pack'] }),
    clips: b.query<{ clips: Clip[] }, string>({ query: (lang) => ({ url: '/admin/content/clips', params: { lang } }), providesTags: ['Clip'] }),
    uploadClip: b.mutation<{ clip: Clip }, FormData>({ query: (body) => ({ url: '/admin/content/clips', method: 'POST', body }), invalidatesTags: ['Clip'] }),
    deleteClip: b.mutation<unknown, string>({ query: (id) => ({ url: `/admin/content/clips/${id}`, method: 'DELETE' }), invalidatesTags: ['Clip'] }),
  }),
})

export const {
  useMeQuery, useLoginMutation, useLogoutMutation, useSummaryQuery, useReferralsQuery, useReferralQuery, useReferralClientQuery,
  useSetStatusMutation, useOnwardMutation, useFacilitiesQuery, useCreateFacilityMutation, useUpdateFacilityMutation,
  useUsersQuery, useCreateUserMutation, useSetUserPasswordMutation, useSetUserActiveMutation, useDevicesQuery, useCreateDeviceMutation,
  useReissueCodeMutation, useDeactivateDeviceMutation, useProvidersQuery, useCreateProviderMutation, useUpdateProviderMutation,
  usePacksQuery, useUploadPackMutation, useClipsQuery, useDeleteClipMutation, useUploadClipMutation, useTemplatesQuery, useCreateTemplateMutation,
  usePreviewUploadMutation, usePreviewDhis2Mutation, useBatchesQuery, useCommitBatchMutation, useUndoBatchMutation,
  useExportPreviewQuery, useExportPushMutation, useExportHistoryQuery, useAuditQuery, useSmsBalanceQuery, useSmsLogQuery,
} = endpoints
