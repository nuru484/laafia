import { generateSeed } from '@laafia/core'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { write, type Tx } from './platform/db.ts'
import { buildDeps, type Deps } from './platform/deps.ts'
import { fromWire } from './platform/http/wire.ts'
import { GATEWAY_DEVICE } from './modules/referrals/index.ts'
import { hashPassword } from './platform/passwords.ts'
import { seedActivity } from './seed-activity.ts'

const DAY = 86_400_000

const DISTRICTS = [
  { id: 'dist-sav', code: 'SAV', name: 'Savelugu Municipal' },
  { id: 'dist-tml', code: 'TML', name: 'Tamale Metropolitan' },
]

/** Fixed demo activation codes so the phones can be activated from the README. Demo only. */
export const DEMO_CODES: Record<string, string> = { D001: '26100001', F001: '26100003', F002: '26100004', F003: '26100005', D002: '26100006' }

type Upsertable = { upsert(args: { where: { id: string }; create: never; update: never }): Promise<unknown> }

/** Insert or overwrite each row by id (wire-shaped rows from the core seed). */
async function upsertAll(model: unknown, rows: Record<string, unknown>[]) {
  for (const wire of rows) {
    const { id, ...data } = fromWire(wire)
    await (model as Upsertable).upsert({ where: { id: id as string }, create: { id, ...data } as never, update: data as never })
  }
}

/** By id; a district made earlier under the same code (an older seed, the dashboard) is folded into the demo one. */
async function upsertDistricts(tx: Tx) {
  for (const d of DISTRICTS) {
    const old = await tx.district.findFirst({ where: { code: d.code, id: { not: d.id } } })
    if (old) await tx.district.update({ where: { id: old.id }, data: { code: `${d.code}-${old.id}` } })
    await tx.district.upsert({ where: { id: d.id }, create: d, update: d })
    if (!old) continue
    await tx.user.updateMany({ where: { districtId: old.id }, data: { districtId: d.id } })
    await tx.facility.updateMany({ where: { districtId: old.id }, data: { districtId: d.id } })
    await tx.district.delete({ where: { id: old.id } })
  }
}

/** The device the server signs its own SMS with. Its key is generated once and kept across re-seeds. */
async function ensureGateway(tx: Tx, now: number) {
  await tx.device.upsert({
    where: { id: GATEWAY_DEVICE }, update: {},
    create: { id: GATEWAY_DEVICE, updatedAt: now, deviceId: 'seed', role: 'gateway', userName: 'SMS gateway', keyHex: randomBytes(32).toString('hex') },
  })
}

/** Load the deterministic demo catchment (core generateSeed). Safe to re-run: it overwrites the seed rows. */
export async function seedDemo(deps: Deps, users: SeedUsers, today = Date.now()) {
  const s = generateSeed(today)
  const now = deps.clock()
  const base = { updated_at: now, device_id: 'seed', deleted: false }
  const facOf = Object.fromEntries(s.facilities.map((f) => [f.code, f.id]))
  const home = facOf['SAV-CHPS-01']!
  await write(deps.prisma, async (tx: Tx) => {
    await upsertDistricts(tx)
    await upsertAll(tx.facility, s.facilities.map((f) => ({ ...base, ...f, district_id: f.code.startsWith('TTH') ? 'dist-tml' : 'dist-sav' })))
    await upsertAll(tx.device, s.devices.map((d) => ({
      ...base, id: d.id, role: d.role, user_name: d.user_name, phone_number: d.phone_number,
      facility_id: facOf[d.facility_code] ?? null, key_hex: d.key_hex, active: true, activated_at: null,
    })))
    await ensureGateway(tx, now)
    await upsertAll(tx.household, s.households.map((h) => ({ ...base, ...h, facility_id: home })))
    await upsertAll(tx.client, s.clients.map((c) => ({ ...base, ...c, facility_id: home, risk_flags: [] })))
    await upsertAll(tx.visit, s.visits.map((v) => ({ ...base, ...v, facility_id: home, notes: null })))
    for (const [deviceId, code] of Object.entries(DEMO_CODES)) {
      const data = { deviceId, expiresAt: now + 7 * DAY, usedAt: null }
      await tx.activationCode.upsert({ where: { code }, create: { code, ...data }, update: data })
    }
    await upsertUsers(tx, [...adminAccounts(users, await ensureDistrict(tx, users.district)), ...DEMO_STAFF], users.password, now)
  })
  return s
}

export type SeedUsers = { password: string; admins: { name: string; email: string }[]; district: { code: string; name: string } }

/**
 * From .env: SEED_ADMINS ("Name email" or "Name <email>", comma-separated), SEED_PASSWORD (10+ characters, every seeded account's),
 * and the admins' district, SEED_DISTRICT_CODE and SEED_DISTRICT_NAME (SAV is the demo district).
 */
export function seedUsersFromEnv(env: Record<string, string | undefined> = process.env): SeedUsers {
  const password = env.SEED_PASSWORD?.trim() ?? ''
  const admins = (env.SEED_ADMINS ?? '').split(',').filter((a) => a.trim()).map((a) => /^\s*(.+?)\s*<?\s*(\S+@[^\s>]+)\s*>?\s*$/.exec(a))
  const code = env.SEED_DISTRICT_CODE?.trim().toUpperCase() ?? ''
  const name = env.SEED_DISTRICT_NAME?.trim() ?? ''
  const problems = [
    password.length < 10 && 'SEED_PASSWORD must be at least 10 characters',
    !/^[A-Z]{2,10}$/.test(code) && 'SEED_DISTRICT_CODE must be 2 to 10 letters, e.g. SAV',
    !name && 'SEED_DISTRICT_NAME must be set',
    (!admins.length || admins.some((m) => !m)) && 'SEED_ADMINS must be "Name email", comma-separated',
  ].filter(Boolean)
  if (problems.length) throw new Error(`${problems.join('; ')} (see apps/api/.env.example)`)
  return { password, admins: admins.map((m) => ({ name: m![1]!, email: m![2]!.toLowerCase() })), district: { code, name } }
}

/** The admins' district by code, created on first use; returns its id. */
async function ensureDistrict(tx: Tx, d: SeedUsers['district']) {
  return (await tx.district.upsert({ where: { code: d.code }, update: {}, create: { id: `dist-${d.code.toLowerCase()}`, ...d } })).id
}

type Account = { id?: string; name: string; email: string; role: string; facilityId: string | null; districtId: string | null; scope: string }

/** Demo staff, one per other role. */
const DEMO_STAFF: Account[] = [
  { id: 'usr-0002', name: 'Dr. Fuseini Abdulai', email: 'supervisor@laafia.demo', role: 'supervisor', facilityId: null, districtId: 'dist-sav', scope: 'Savelugu district' },
  { id: 'usr-0003', name: 'Salamatu Iddrisu', email: 'hospital@laafia.demo', role: 'facility_staff', facilityId: 'fac-0003', districtId: null, scope: 'Savelugu Municipal Hospital' },
  { id: 'usr-0004', name: 'Rahinatu Mahama', email: 'healthcentre@laafia.demo', role: 'facility_staff', facilityId: 'fac-0002', districtId: null, scope: 'Pong-Tamale Health Centre' },
]
const adminAccounts = (u: SeedUsers, districtId: string): Account[] =>
  u.admins.map((a) => ({ ...a, role: 'district_admin', facilityId: null, districtId, scope: u.district.name }))

/** Inserted or reset by email; the password is set to the seed's. */
async function upsertUsers(tx: Tx, users: Account[], password: string, now: number) {
  const passwordHash = await hashOnce(password)
  for (const { id, scope: _, ...u } of users) {
    const data = { ...u, passwordHash, active: true, passwordChangedAt: now }
    await tx.user.upsert({ where: { email: u.email }, create: { id: id ?? randomUUID(), ...data, createdAt: now }, update: data })
  }
}

// Hashed once per process: the tests re-seed before every case.
let hashed: { password: string; hash: Promise<string> } | null = null
const hashOnce = (password: string) => (hashed?.password === password ? hashed : (hashed = { password, hash: hashPassword(password) })).hash

/** Only the district admins, and their district if it is new (npm run seed:admin). */
export async function seedAdmins(deps: Deps, users: SeedUsers) {
  const now = deps.clock()
  await write(deps.prisma, async (tx: Tx) => {
    await upsertUsers(tx, adminAccounts(users, await ensureDistrict(tx, users.district)), users.password, now)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deps = buildDeps()
  try {
    const users = seedUsersFromEnv()
    const adminsOnly = process.argv[2] === 'admins'
    if (adminsOnly) await seedAdmins(deps, users)
    else {
      const s = await seedDemo(deps, users)
      console.log(`seeded ${s.facilities.length} facilities, ${s.households.length} households, ${s.clients.length} clients, ${s.visits.length} visits`)
      console.log('activation codes (valid 7 days, single use; re-run seed to reset):')
      for (const d of s.devices) console.log(`  ${DEMO_CODES[d.id]}  ${d.id}  ${d.role.padEnd(9)} ${d.user_name} (${d.facility_code})`)
    }
    console.log('dashboard users (password: SEED_PASSWORD):')
    for (const u of [...users.admins.map((a) => ({ ...a, role: 'district_admin', scope: users.district.name })), ...(adminsOnly ? [] : DEMO_STAFF)]) console.log(`  ${u.email.padEnd(26)} ${u.role.padEnd(15)} ${u.name} (${u.scope})`)
    if (!adminsOnly) {
      const a = await seedActivity(deps)
      console.log(`demo activity: ${a.referrals} referrals with events, device syncs, SMS log, audit`)
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await deps.prisma.$disconnect()
  }
}
