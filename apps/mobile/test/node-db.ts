/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite'
import type { Db, Param } from '../src/lib/db/db'
import { migrate } from '../src/lib/db/schema'

/** In-memory SQLite with the app's real schema, for tests. */
export async function testDb(): Promise<Db> {
  // Same as the phone: foreign keys are declared but not enforced (see schema.ts).
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
  const db: Db = {
    async exec(sql) { d.exec(sql) },
    async run(sql, params: Param[] = []) { return { changes: Number(d.prepare(sql).run(...params).changes) } },
    async all<T>(sql: string, params: Param[] = []) { return d.prepare(sql).all(...params) as T[] },
    async get<T>(sql: string, params: Param[] = []) { return d.prepare(sql).get(...params) as T | undefined },
    async tx(fn) {
      d.exec('BEGIN')
      try { const r = await fn(); d.exec('COMMIT'); return r } catch (e) { d.exec('ROLLBACK'); throw e }
    },
  }
  await migrate(db)
  return db
}
