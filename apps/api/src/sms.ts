import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { db, type Tx } from './db.ts'
import { log } from './http.ts'
import { jobs } from './schema.ts'

/** Same schedule as the phone outbox (spec 11.2): 30 s, 2 min, 10 min, then hourly; failed after 8 attempts. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000]
const MAX_ATTEMPTS = 8
const LEASE_MS = 5 * 60_000

/** Transactional enqueue: the SMS is sent only if the write that caused it commits. */
export async function enqueueSms(tx: Tx, to: string, body: string) {
  const now = Date.now()
  await tx.insert(jobs).values({ kind: 'sms', payload: { to, body }, run_at: now, created_at: now })
}

/** Ghana local 0XXXXXXXXX to the 233XXXXXXXXX form Arkesel expects. */
const international = (phone: string) => (phone.startsWith('0') ? '233' + phone.slice(1) : phone.replace(/^\+/, ''))

/**
 * Arkesel SMS API v2 (https://developers.arkesel.com): POST /api/v2/sms/send with an `api-key` header.
 * Without ARKESEL_API_KEY the message is only logged (dev). Wire bodies carry codes, never names.
 */
export async function sendSms(to: string, body: string): Promise<void> {
  const key = process.env.ARKESEL_API_KEY
  if (!key) {
    log('info', 'sms_dev_send', { to, body })
    return
  }
  const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: process.env.ARKESEL_SENDER ?? 'Laafia', message: body, recipients: [international(to)] }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json().catch(() => null)) as { status?: string; message?: string } | null
  if (!res.ok || json?.status !== 'success') throw new Error(`arkesel ${res.status}: ${json?.message ?? 'no body'}`)
}

/** Send due jobs. Claims rows with SKIP LOCKED and a lease, then sends outside the transaction. */
export async function runJobs(limit = 20): Promise<number> {
  const now = Date.now()
  const due = await db.transaction(async (tx) => {
    const rows = await tx.select().from(jobs).where(and(eq(jobs.status, 'pending'), lte(jobs.run_at, now))).orderBy(asc(jobs.id)).limit(limit).for('update', { skipLocked: true })
    if (rows.length) await tx.update(jobs).set({ run_at: now + LEASE_MS }).where(inArray(jobs.id, rows.map((r) => r.id)))
    return rows
  })
  for (const job of due) {
    try {
      await sendSms(job.payload.to, job.payload.body)
      await db.update(jobs).set({ status: 'sent', attempts: job.attempts + 1, last_error: null }).where(eq(jobs.id, job.id))
    } catch (e) {
      const attempts = job.attempts + 1
      const failed = attempts >= MAX_ATTEMPTS
      await db.update(jobs).set({
        attempts, last_error: String(e).slice(0, 500), status: failed ? 'failed' : 'pending',
        run_at: Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!,
      }).where(eq(jobs.id, job.id))
      log('warn', 'sms_send_failed', { job_id: job.id, attempts, failed })
    }
  }
  if (due.length) log('info', 'sms_jobs_run', { count: due.length })
  return due.length
}

export function startJobWorker(intervalMs = 5_000) {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await runJobs()
    } catch (e) {
      log('error', 'job_worker', { error: String(e) })
    } finally {
      running = false
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
