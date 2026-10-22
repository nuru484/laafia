import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@prisma/client'

/*
 * Prisma client. Epoch-millisecond columns are SQL bigint, which Prisma returns
 * as JS bigint; the result extension below returns them as numbers (exact up to
 * 2^53, far past any timestamp or sequence here) so rows serialise as JSON and
 * compare with Date.now(). Inputs already accept numbers for BigInt fields.
 */

type Field<K extends string, T> = { [P in K]: { needs: { [Q in P]: true }; compute: (r: { [Q in P]: bigint | null }) => T } }
function num<K extends string>(...fields: K[]): Field<K, number> {
  return Object.fromEntries(fields.map((f) => [f, { needs: { [f]: true }, compute: (r: Record<string, bigint>) => Number(r[f]) }])) as unknown as Field<K, number>
}
function numOrNull<K extends string>(...fields: K[]): Field<K, number | null> {
  return Object.fromEntries(fields.map((f) => [f, { needs: { [f]: true }, compute: (r: Record<string, bigint | null>) => (r[f] === null ? null : Number(r[f])) }])) as unknown as Field<K, number | null>
}

const sync = num('updatedAt', 'seq')
const numbers = {
  facility: sync,
  device: { ...sync, ...numOrNull('activatedAt') },
  activationCode: { ...num('expiresAt'), ...numOrNull('usedAt') },
  household: { ...sync, ...numOrNull('consentAt') },
  client: { ...sync, ...numOrNull('dob', 'edd', 'deliveryDate') },
  visit: { ...sync, ...num('visitedAt'), ...numOrNull('followupDue') },
  referral: sync,
  referralEvent: { ...sync, ...num('at') },
  transportProvider: sync,
  transportRequest: { ...sync, ...numOrNull('scheduledFor') },
  job: { ...num('id', 'runAt', 'createdAt'), ...numOrNull('deliveredAt') },
  mappingTemplate: num('createdAt'),
  importBatch: { ...num('createdAt'), ...numOrNull('committedAt', 'undoneAt') },
  contentPack: num('size', 'createdAt'),
  contentClip: num('recordedAt'),
}

export function createPrisma(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), transactionOptions: { maxWait: 10_000, timeout: 30_000 } })
    .$extends({ result: numbers })
}

export type Db = ReturnType<typeof createPrisma>
export type Tx = Omit<Db, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>
export { Prisma }

/**
 * Every write to a synced table goes through here. The advisory lock makes
 * commit order equal `seq` order, so a pull can never skip a row whose seq is
 * below its cursor but which committed after the pull read.
 * Limit: one global write lock serialises all writes; enough for a district, shard it per facility if pushes queue.
 */
export function write<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    // Raw: Prisma has no API for advisory locks.
    await tx.$executeRaw`select pg_advisory_xact_lock(4242)`
    return fn(tx)
  })
}

/**
 * Run `fn` inside a savepoint, so a failing row rolls back alone and the batch
 * continues. Raw: Prisma has no nested transactions or savepoint API.
 */
export async function savepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  await tx.$executeRaw`savepoint row_write`
  try {
    const out = await fn()
    await tx.$executeRaw`release savepoint row_write`
    return out
  } catch (e) {
    await tx.$executeRaw`rollback to savepoint row_write`
    throw e
  }
}
