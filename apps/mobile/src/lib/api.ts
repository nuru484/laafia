import Constants from 'expo-constants'
import type { Api } from './sync'

/** A development build loads its JS from the laptop's bundler, so the API is on that machine unless EXPO_PUBLIC_API_URL names another. */
const bundlerHost = Constants.expoConfig?.hostUri?.split(':')[0]
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (bundlerHost ? `http://${bundlerHost}:4000` : '')).replace(/\/$/, '')

/** The API's error envelope (docs/API.md Conventions); `code` is what callers branch on. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const TIMEOUT_MS = 20_000

async function call(method: string, path: string, body: unknown, jwt: string | null, init: RequestInit = {}): Promise<any> {
  if (!API_URL) throw new ApiError(0, 'no_api_url', 'This build has no server address')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const isForm = body instanceof FormData
    const res = await fetch(API_URL + path, {
      method,
      signal: controller.signal,
      headers: {
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      ...init,
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) throw new ApiError(res.status, json?.code ?? 'http_error', json?.message ?? `HTTP ${res.status}`)
    return json
  } catch (e) {
    if (e instanceof ApiError) throw e
    // Offline, DNS failure, timeout: the caller treats all of these as "no internet right now".
    throw new ApiError(0, 'offline', e instanceof Error ? e.message : 'network error')
  } finally {
    clearTimeout(timer)
  }
}

export function publicCall(method: 'GET' | 'POST', path: string, body?: unknown) {
  return call(method, path, body, null)
}

/**
 * Device API client. An expired token is refreshed once and the call retried;
 * `deactivated` is passed to the caller, which wipes the phone (spec 18.2).
 */
export function deviceApi(getJwt: () => Promise<string | null>, setJwt: (jwt: string) => Promise<void>): Api & { upload: (path: string, form: FormData) => Promise<any> } {
  const withRefresh = async (fn: (jwt: string | null) => Promise<any>) => {
    const jwt = await getJwt()
    try {
      return await fn(jwt)
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'invalid_token' || !jwt) throw e
      const { jwt: fresh } = await call('POST', '/auth/refresh', undefined, jwt)
      await setJwt(fresh)
      return fn(fresh)
    }
  }
  return {
    request: (method, path, body) => withRefresh((jwt) => call(method, path, body, jwt)),
    upload: (path, form) => withRefresh((jwt) => call('POST', path, form, jwt)),
  }
}
