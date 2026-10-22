import { enqueueSms, type Env } from './relay'

/*
 * Visits booked by the client's SMS or by the nurse (spec 14.1). Appointments
 * stay on the nurse's phone. The client is texted a confirmation and, the
 * morning before, a reminder; a booked client is on Today from that day until
 * a visit is recorded.
 */

const DAY = 86_400_000
const REMIND_AT_HOUR = 8

/** Start of the UTC day, which is Ghana's local day. */
export const dayStart = (t: number) => Math.floor(t / DAY) * DAY

export const dayLabel = (day: number) => new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export type BookingRequest = { id: string; client_id: string | null; client_name: string | null; client_code: string | null; phone: string; message: string | null; requested_at: number }

export function bookingRequests(env: Env): Promise<BookingRequest[]> {
  return env.db.all<BookingRequest>(
    `SELECT a.id, a.client_id, c.name AS client_name, c.code AS client_code, a.phone, a.message, a.requested_at
       FROM appointments a LEFT JOIN clients c ON c.id = a.client_id
      WHERE a.status = 'requested' ORDER BY a.requested_at, a.rowid`)
}

async function nurse(env: Env): Promise<string> {
  const me = await env.db.get<{ user_name: string; facility: string | null }>(
    'SELECT d.user_name, f.name AS facility FROM devices d LEFT JOIN facilities f ON f.code = d.facility_code WHERE d.id = ?', [env.self.device_id])
  return me ? `${me.user_name}${me.facility ? ` (${me.facility})` : ''}` : 'your nurse'
}

/** Drops earlier confirmed dates for the client, and their texts that have not gone out yet. */
async function replaceEarlier(env: Env, clientId: string, keep: string) {
  const old = await env.db.all<{ id: string }>("SELECT id FROM appointments WHERE client_id = ? AND status = 'confirmed' AND id != ?", [clientId, keep])
  for (const { id } of old) {
    await env.db.run("UPDATE appointments SET status = 'replaced' WHERE id = ?", [id])
    await env.db.run("DELETE FROM outbox WHERE ref_table = 'appointments' AND ref_id = ? AND status = 'pending'", [id])
  }
}

async function textConfirmation(env: Env, appointmentId: string, phone: string, day: number) {
  const who = await nurse(env)
  await enqueueSms(env, phone, `Laafia: ${who} will see you on ${dayLabel(day)}. If you cannot come, reply to this number.`, 'appointments', appointmentId)
  const remindAt = day - DAY + REMIND_AT_HOUR * 3_600_000
  if (remindAt > env.now()) {
    await enqueueSms(env, phone, `Laafia reminder: your visit with ${who} is tomorrow, ${dayLabel(day)}.`, 'appointments', appointmentId, remindAt)
  }
}

/** Confirms a request for a day. A request from an unknown number names the client, whose phone is then saved. */
export async function confirmBooking(env: Env, id: string, opts: { day: number; client_id?: string }): Promise<void> {
  const a = await env.db.get<{ client_id: string | null; phone: string }>("SELECT client_id, phone FROM appointments WHERE id = ? AND status = 'requested'", [id])
  if (!a) throw new Error('This booking request is no longer open')
  const clientId = a.client_id ?? opts.client_id
  if (!clientId) throw new Error('Choose the client this request is for')
  const day = dayStart(opts.day)
  await env.db.tx(async () => {
    if (!a.client_id) await env.db.run('UPDATE clients SET phone = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?', [a.phone, env.now(), env.self.device_id, clientId])
    await env.db.run("UPDATE appointments SET status = 'confirmed', client_id = ?, scheduled_for = ? WHERE id = ?", [clientId, day, id])
    await replaceEarlier(env, clientId, id)
    await textConfirmation(env, id, a.phone, day)
  })
}

export async function declineBooking(env: Env, id: string): Promise<void> {
  const a = await env.db.get<{ phone: string }>("SELECT phone FROM appointments WHERE id = ? AND status = 'requested'", [id])
  if (!a) throw new Error('This booking request is no longer open')
  await env.db.tx(async () => {
    await env.db.run("UPDATE appointments SET status = 'declined' WHERE id = ?", [id])
    await enqueueSms(env, a.phone, `Laafia: ${await nurse(env)} could not fix a visit by text. Please call ${env.self.phone}.`, 'appointments', id)
  })
}

/** The nurse books a visit herself; the client is texted when her phone is known. */
export async function scheduleVisit(env: Env, clientId: string, dayMs: number): Promise<string> {
  const c = await env.db.get<{ phone: string | null }>('SELECT phone FROM clients WHERE id = ?', [clientId])
  if (!c) throw new Error('Unknown client')
  const id = env.uuid()
  const day = dayStart(dayMs)
  await env.db.tx(async () => {
    await env.db.run("INSERT INTO appointments (id, client_id, phone, requested_at, scheduled_for, status, source) VALUES (?,?,?,?,?,'confirmed','nurse')",
      [id, clientId, c.phone ?? '', env.now(), day])
    await replaceEarlier(env, clientId, id)
    if (c.phone) await textConfirmation(env, id, c.phone, day)
  })
  return id
}

/** Booked visits due by today with no visit recorded since the booked day: client id to booked day. */
export async function bookedDue(env: Env): Promise<Map<string, number>> {
  const rows = await env.db.all<{ client_id: string; scheduled_for: number }>(
    `SELECT a.client_id, a.scheduled_for FROM appointments a
      WHERE a.status = 'confirmed' AND a.scheduled_for < ?
        AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.client_id = a.client_id AND v.deleted = 0 AND v.visited_at >= a.scheduled_for)`,
    [dayStart(env.now()) + DAY])
  return new Map(rows.map((r) => [r.client_id, r.scheduled_for]))
}

/** The next booked day for a client, if any. */
export async function nextBooking(env: Env, clientId: string): Promise<number | null> {
  const r = await env.db.get<{ scheduled_for: number }>(
    `SELECT a.scheduled_for FROM appointments a WHERE a.client_id = ? AND a.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.client_id = a.client_id AND v.deleted = 0 AND v.visited_at >= a.scheduled_for)
      ORDER BY a.scheduled_for LIMIT 1`, [clientId])
  return r?.scheduled_for ?? null
}
