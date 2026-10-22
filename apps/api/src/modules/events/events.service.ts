import { randomBytes } from 'node:crypto'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Device } from '../../platform/middleware/auth.ts'
import { facilityFor, visibleTo, type ReferralView } from '../referrals/index.ts'

type Facility = Awaited<ReturnType<typeof facilityFor>>

/*
 * EventSource cannot send headers, so SSE takes a single-use ticket bound to one facility, valid 60 s.
 * ponytail: in-memory tickets, so one API process; move to the database when running several.
 */
const TICKET_MS = 60_000
const tickets = new Map<string, { facility: Facility; expires: number }>()

export async function issueTicket(deps: Deps, device: Device | null, facilityCode: string) {
  const facility = await facilityFor(deps, device, facilityCode)
  const now = deps.clock()
  for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k)
  const ticket = randomBytes(24).toString('base64url')
  const expires_at = now + TICKET_MS
  tickets.set(ticket, { facility, expires: expires_at })
  return { ticket, expires_at }
}

/** Consumes the ticket (single use) and returns its facility. */
export function redeemTicket(deps: Deps, ticket: string | undefined) {
  const entry = ticket ? tickets.get(ticket) : undefined
  if (ticket) tickets.delete(ticket)
  if (!entry || entry.expires < deps.clock()) throw new HttpError(401, 'invalid_ticket', 'Missing, used or expired SSE ticket')
  return entry.facility
}

/** Calls `send` with every referral view visible to the facility until the returned function is called. */
export function subscribe(deps: Deps, facilityId: string, send: (view: ReferralView) => void) {
  const listener = (v: ReferralView) => {
    if (visibleTo(facilityId, v)) send(v)
  }
  deps.bus.on('referral', listener)
  return () => deps.bus.off('referral', listener)
}
