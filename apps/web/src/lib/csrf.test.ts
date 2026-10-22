import { describe, expect, it } from 'vitest'
import { csrfHeaders, readCookie } from './csrf'

describe('csrf', () => {
  it('reads the readable CSRF cookie among others', () => {
    expect(readCookie('a=1; laafia_csrf=abc%3D%3D; b=2', 'laafia_csrf')).toBe('abc==')
    expect(readCookie('a=1', 'laafia_csrf')).toBeNull()
  })

  it('sends the header on unsafe methods only', () => {
    const cookie = 'laafia_csrf=tok'
    expect(csrfHeaders('POST', cookie)).toEqual({ 'X-CSRF-Token': 'tok' })
    expect(csrfHeaders('delete', cookie)).toEqual({ 'X-CSRF-Token': 'tok' })
    expect(csrfHeaders('GET', cookie)).toEqual({})
    expect(csrfHeaders('POST', '')).toEqual({})
  })
})
