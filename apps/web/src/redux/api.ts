import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { csrfHeaders } from '@/lib/csrf'

const raw = fetchBaseQuery({ baseUrl: '/api', credentials: 'same-origin' })

/** Adds the CSRF header to unsafe requests; the session itself travels in an httpOnly cookie. */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (args, api, extra) => {
  const req = typeof args === 'string' ? { url: args } : args
  const headers = { ...(req.headers as Record<string, string> | undefined), ...csrfHeaders(req.method ?? 'GET', typeof document === 'undefined' ? '' : document.cookie) }
  return raw({ ...req, headers }, api, extra)
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Me', 'Referral', 'Summary', 'User', 'Device', 'Facility', 'Audit', 'Sms'],
  endpoints: () => ({}),
})

/** The API's error envelope, or a fallback when the server could not be reached. */
export function errorMessage(error: unknown): string {
  const e = error as { status?: number | string; data?: { message?: string } } | undefined
  if (!e) return ''
  if (e.data?.message) return e.data.message
  if (e.status === 'FETCH_ERROR') return 'The server could not be reached.'
  return 'Something went wrong. Try again.'
}

export function errorCode(error: unknown): string | null {
  return (error as { data?: { code?: string } } | undefined)?.data?.code ?? null
}
