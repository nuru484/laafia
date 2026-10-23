import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

// Behaves like expo-sqlite's native module: every open of a name gets the same connection, which outlives a
// Fast Refresh, and an open database cannot be deleted.
const connections = new Map<string, { db: DatabaseSync; refs: number }>()
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    const c = connections.get(name) ?? { db: new DatabaseSync(':memory:'), refs: 0 }
    connections.set(name, c)
    c.refs++
    return {
      execAsync: async (sql: string) => { if (!sql.startsWith('PRAGMA key')) c.db.exec(sql) },
      getFirstAsync: async (sql: string, params: never[] = []) => (sql === 'PRAGMA cipher_version' ? { cipher_version: '4.6.1' } : c.db.prepare(sql).get(...params) ?? null),
      getAllAsync: async (sql: string, params: never[] = []) => c.db.prepare(sql).all(...params),
      runAsync: async (sql: string, params: never[] = []) => ({ changes: Number(c.db.prepare(sql).run(...params).changes) }),
      closeAsync: async () => { if (--c.refs === 0) { c.db.close(); connections.delete(name) } },
    }
  },
  deleteDatabaseAsync: async (name: string) => { if (connections.has(name)) throw new Error(`database is open: ${name}`) },
}))
const store = new Map<string, string>()
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}))
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }))

const { openDb, wipeDb } = await import('./expo')
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('expo database', () => {
  it('a second open, as after a Fast Refresh, shares the transaction queue instead of colliding', async () => {
    const before = await openDb()
    const after = await openDb()
    await Promise.all([
      before.tx(async () => { await before.run("INSERT INTO meta (key, value) VALUES ('a', '1')"); await tick() }),
      after.tx(async () => { await after.run("INSERT INTO meta (key, value) VALUES ('b', '1')"); await tick() }),
    ])
    expect(await after.all("SELECT key FROM meta WHERE key IN ('a', 'b') ORDER BY key")).toEqual([{ key: 'a' }, { key: 'b' }])
    await wipeDb()
  })

  it('the wipe really deletes the patient data', async () => {
    const db = await openDb()
    await db.run("INSERT INTO meta (key, value) VALUES ('kept', '1')")
    await wipeDb()
    const fresh = await openDb()
    expect(await fresh.get("SELECT value FROM meta WHERE key = 'kept'")).toBeUndefined()
    await wipeDb()
  })
})
