import type { Tx } from '../db.ts'
import type { Deps } from '../deps.ts'

/** Same schedule as the phone outbox (spec 11.2): 30 s, 2 min, 10 min, then hourly; failed after 8 attempts. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000]
export const MAX_ATTEMPTS = 8
const LEASE_MS = 5 * 60_000

export const backoff = (attempts: number) => BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!

/** The msgid handed to Frog embeds the job id, so a delivery receipt maps straight back to its job. */
export const frogMsgId = (jobId: number, at: number) => `LF_${jobId}_${at}`
export const jobIdOfMsgId = (msgid: string) => {
  const m = /^LF_(\d{1,15})_\d+$/.exec(msgid)
  return m ? Number(m[1]) : null
}

/** Transactional enqueue: the SMS is sent only if the write that caused it commits. */
export type SmsPurpose = 'ack' | 'status' | 'driver' | 'referral'

/**
 * `facilityId` is the facility the SMS is about; its district scopes the dashboard SMS log.
 * `runAt` defaults to now (a scheduled pickup passes a later time).
 */
export async function enqueueSms(tx: Tx, now: number, to: string, body: string, opts: { purpose: SmsPurpose; facilityId?: string | null; dedupeKey?: string; runAt?: number }) {
  const facility = opts.facilityId ? await tx.facility.findUnique({ where: { id: opts.facilityId }, select: { districtId: true } }) : null
  // skipDuplicates: a second job with the same dedupe key is dropped instead of failing the write.
  await tx.job.createMany({
    data: [{ kind: 'sms', payload: { to, body }, runAt: opts.runAt ?? now, createdAt: now, dedupeKey: opts.dedupeKey ?? null, purpose: opts.purpose, districtId: facility?.districtId ?? null }],
    skipDuplicates: true,
  })
}

/**
 * Send due jobs. Claims a batch by moving its run_at forward (a lease) with a
 * guarded update, so two workers never send the same job, then sends outside
 * any transaction.
 */
export async function runJobs(deps: Deps, limit = 20): Promise<number> {
  const { prisma, clock, logger } = deps
  const now = clock()
  const due = await prisma.job.findMany({ where: { status: 'pending', runAt: { lte: now } }, orderBy: { id: 'asc' }, take: limit })
  let sent = 0
  for (const job of due) {
    const claimed = await prisma.job.updateMany({ where: { id: job.id, status: 'pending', runAt: job.runAt }, data: { runAt: now + LEASE_MS } })
    if (!claimed.count) continue
    const { to, body } = job.payload as { to: string; body: string }
    try {
      await deps.sms.send(to, body, frogMsgId(job.id, now))
      await prisma.job.update({ where: { id: job.id }, data: { status: 'sent', attempts: job.attempts + 1, lastError: null } })
      sent += 1
    } catch (e) {
      const attempts = job.attempts + 1
      const failed = attempts >= MAX_ATTEMPTS
      await prisma.job.update({
        where: { id: job.id },
        data: { attempts, lastError: String(e).slice(0, 500), status: failed ? 'failed' : 'pending', runAt: clock() + backoff(attempts) },
      })
      logger.warn('sms_send_failed', { job_id: job.id, attempts, failed })
    }
  }
  if (due.length) logger.info('sms_jobs_run', { count: due.length, sent })
  return due.length
}

export function startJobWorker(deps: Deps, intervalMs = 5_000) {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try {
      await runJobs(deps)
    } catch (e) {
      deps.logger.error('job_worker', { error: String(e) })
    } finally {
      running = false
    }
  }, intervalMs)
  return () => clearInterval(timer)
}
