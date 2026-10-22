import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { env } from './env.ts'
import * as schema from './schema.ts'

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 })
export const db = drizzle(pool, { schema })
export type Db = typeof db
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Every write to a synced table goes through here. The advisory lock makes
 * commit order equal `seq` order, so a pull can never skip a row whose seq is
 * below the cursor but which committed after the pull read.
 * ponytail: one global write lock; fine for a district, shard the lock per facility if pushes queue up.
 */
export function write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4242)`)
    return fn(tx)
  })
}

export const runMigrations = () => migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
