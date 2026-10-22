import type { Tx } from '../db.ts'
import type { Deps } from '../deps.ts'

/** Same schedule as the phone outbox (spec 11.2): 30 s, 2 min, 10 min, then hourly; failed after 8 attempts. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000]
export const MAX_ATTEMPTS = 8
const LEASE_MS = 5 * 60_000

export const backoff = (attempts: number) => BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!

/** Transactional enqueue: the SMS is sent only if the write that caused it commits. */
export async function enqueueSms(tx: Tx, now: number, to: string, body: string) {
  await tx.job.create({ data: { kind: 'sms', payload: { to, body }, runAt: now, createdAt: now } })
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
      await deps.sms.send(to, body)
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
