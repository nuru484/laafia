import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'
import type { Db, Param } from './db'
import { migrate } from './schema'

const DB_NAME = 'laafia.db'
const KEY_ITEM = 'laafia_db_key'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The SQLCipher key is 32 random bytes kept in the Android Keystore through
 * SecureStore, not derived from the PIN, so the SMS receiver path and the
 * workers can open the database while the PIN screen is up. The PIN gates the
 * UI (spec 18.2) and its lockout wipes this database.
 */
async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_ITEM)
  if (existing) return existing
  const key = hex(Crypto.getRandomBytes(32))
  await SecureStore.setItemAsync(KEY_ITEM, key)
  return key
}

export async function openDb(): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(DB_NAME)
  // Raw-key form skips SQLCipher's passphrase KDF; the key is already random.
  await raw.execAsync(`PRAGMA key = "x'${await databaseKey()}'"`)
  const cipher = await raw.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version')
  if (!cipher?.cipher_version) throw new Error('SQLCipher is not in this build; refusing to store patient data unencrypted')
  await raw.execAsync('PRAGMA journal_mode = WAL')

  // ponytail: transactions are serialised against each other, but a statement from another flow can still land
  // inside an open transaction on this single connection; move to withExclusiveTransactionAsync if that bites.
  let queue: Promise<unknown> = Promise.resolve()
  const db: Db = {
    async exec(sql) { await raw.execAsync(sql) },
    async run(sql, params: Param[] = []) { const r = await raw.runAsync(sql, params); return { changes: r.changes } },
    async all<T>(sql: string, params: Param[] = []) { return raw.getAllAsync<T>(sql, params) },
    async get<T>(sql: string, params: Param[] = []) { return (await raw.getFirstAsync<T>(sql, params)) ?? undefined },
    tx<T>(fn: () => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        await raw.execAsync('BEGIN IMMEDIATE')
        try {
          const r = await fn()
          await raw.execAsync('COMMIT')
          return r
        } catch (e) {
          await raw.execAsync('ROLLBACK')
          throw e
        }
      })
      queue = run.catch(() => undefined)
      return run
    },
  }
  await migrate(db)
  return db
}

/** PIN lockout (10 wrong attempts) and remote deactivation. Synced records are already on the server. */
export async function wipeDb(): Promise<void> {
  await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => undefined)
  await SecureStore.deleteItemAsync(KEY_ITEM)
}
