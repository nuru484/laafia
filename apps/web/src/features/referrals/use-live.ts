'use client'

import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { readCookie, CSRF_COOKIE } from '@/lib/csrf'
import { api } from '@/redux/api'

/**
 * Live inbox for one facility over server-sent events. EventSource cannot send
 * headers, so a single-use ticket is fetched first, and again on every reconnect.
 */
export function useLiveReferrals(facilityCode: string | null) {
  const dispatch = useDispatch()
  useEffect(() => {
    if (!facilityCode) return
    let source: EventSource | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      try {
        const res = await fetch('/api/events/ticket', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': readCookie(document.cookie, CSRF_COOKIE) ?? '' },
          body: JSON.stringify({ facility: facilityCode }),
        })
        if (!res.ok) throw new Error(`ticket ${res.status}`)
        const { ticket } = (await res.json()) as { ticket: string }
        if (stopped) return
        source = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`)
        source.onmessage = () => dispatch(api.util.invalidateTags(['Referral', 'Summary']))
        source.addEventListener('referral', () => dispatch(api.util.invalidateTags(['Referral', 'Summary'])))
        source.onerror = () => {
          source?.close()
          if (!stopped) retry = setTimeout(connect, 5000)
        }
      } catch {
        if (!stopped) retry = setTimeout(connect, 10_000)
      }
    }
    void connect()
    return () => {
      stopped = true
      source?.close()
      if (retry) clearTimeout(retry)
    }
  }, [facilityCode, dispatch])
}
