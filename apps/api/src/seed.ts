import { generateSeed } from '@laafia/core'
import { getTableColumns, sql } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { pool, write, type Tx } from './db.ts'
import { activation_codes, clients, devices, districts, facilities, households, transport_providers, visits } from './schema.ts'

export const GATEWAY_DEVICE = 'GW01'
const DAY = 86_400_000

const DISTRICTS = [
  { id: 'dist-sav', code: 'SAV', name: 'Savelugu Municipal', languages: ['dag'] },
  { id: 'dist-tml', code: 'TML', name: 'Tamale Metropolitan', languages: ['dag'] },
]

/** Fixed demo activation codes so the phones can be activated from the README. Demo only. */
export const DEMO_CODES: Record<string, string> = { D001: '26100001', V001: '26100002', F001: '26100003', F002: '26100004', F003: '26100005' }

async function upsertAll(tx: Tx, table: PgTable, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const columns = getTableColumns(table)
  const set = Object.fromEntries(Object.keys(columns).filter((c) => c !== 'id' && c !== 'seq').map((c) => [c, sql.raw(`excluded."${c}"`)]))
  await tx.insert(table).values(rows).onConflictDoUpdate({ target: columns.id!, set })
}

/** Load the deterministic demo catchment (core generateSeed). Safe to re-run: it overwrites the seed rows. */
export async function seedDemo(today = Date.now()) {
  const s = generateSeed(today)
  const now = Date.now()
  const base = { updated_at: now, device_id: 'seed', deleted: false }
  const facOf = Object.fromEntries(s.facilities.map((f) => [f.code, f.id]))
  const home = facOf['SAV-CHPS-01']!
  await write(async (tx) => {
    await upsertAll(tx, districts, DISTRICTS)
    await upsertAll(tx, facilities, s.facilities.map((f) => ({ ...base, ...f, district_id: f.code.startsWith('TTH') ? 'dist-tml' : 'dist-sav', languages: f.level === 'chps' ? ['dag'] : [] })))
    await upsertAll(tx, devices, s.devices.map((d) => ({
      ...base, id: d.id, role: d.role, user_name: d.user_name, phone_number: d.phone_number,
      facility_id: facOf[d.facility_code] ?? null, key_hex: d.key_hex, active: true, activated_at: null,
    })))
    await tx.insert(devices).values({ ...base, id: GATEWAY_DEVICE, role: 'gateway', user_name: 'SMS gateway', key_hex: randomBytes(32).toString('hex') }).onConflictDoNothing()
    await upsertAll(tx, households, s.households.map((h) => ({ ...base, ...h, facility_id: home })))
    await upsertAll(tx, clients, s.clients.map((c) => ({ ...base, ...c, facility_id: home, risk_flags: [] })))
    await upsertAll(tx, visits, s.visits.map((v) => ({ ...base, ...v, facility_id: home, notes: null })))
    await upsertAll(tx, transport_providers, s.transport_providers.map((p) => ({ ...base, ...p, facility_id: home, active: true })))
    for (const [device_id, code] of Object.entries(DEMO_CODES)) {
      await tx.insert(activation_codes).values({ code, device_id, expires_at: now + 7 * DAY, used_at: null })
        .onConflictDoUpdate({ target: activation_codes.code, set: { device_id, expires_at: now + 7 * DAY, used_at: null } })
    }
  })
  return s
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await seedDemo()
  console.log(`seeded ${s.facilities.length} facilities, ${s.households.length} households, ${s.clients.length} clients, ${s.visits.length} visits`)
  console.log('activation codes (valid 7 days, single use; re-run seed to reset):')
  for (const d of s.devices) console.log(`  ${DEMO_CODES[d.id]}  ${d.id}  ${d.role.padEnd(9)} ${d.user_name} (${d.facility_code})`)
  await pool.end()
}
