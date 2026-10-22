export const CSRF_COOKIE = 'laafia_csrf'

export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** The API checks X-CSRF-Token against the session on every unsafe request made with the session cookie. */
export function csrfHeaders(method: string, cookies: string): Record<string, string> {
  if (!UNSAFE.has(method.toUpperCase())) return {}
  const token = readCookie(cookies, CSRF_COOKIE)
  return token ? { 'X-CSRF-Token': token } : {}
}
