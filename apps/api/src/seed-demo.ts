import { generateSeed } from '@laafia/core'
import { randomBytes } from 'node:crypto'
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

/** The device the server signs its own SMS with. Its key is generated once and kept across re-seeds. */
async function ensureGateway(tx: Tx, now: number) {
  await tx.device.upsert({
    where: { id: GATEWAY_DEVICE }, update: {},
    create: { id: GATEWAY_DEVICE, updatedAt: now, deviceId: 'seed', role: 'gateway', userName: 'SMS gateway', keyHex: randomBytes(32).toString('hex') },
  })
}

/** Load the deterministic demo catchment (core generateSeed). Safe to re-run: it overwrites the seed rows. */
export async function seedDemo(deps: Deps, today = Date.now()) {
  const s = generateSeed(today)
  const now = deps.clock()
  const base = { updated_at: now, device_id: 'seed', deleted: false }
  const facOf = Object.fromEntries(s.facilities.map((f) => [f.code, f.id]))
  const home = facOf['SAV-CHPS-01']!
  await write(deps.prisma, async (tx: Tx) => {
    await upsertAll(tx.district, DISTRICTS)
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
    await upsertUsers(tx, DEMO_USERS, now)
  })
  return s
}

/** Dashboard accounts, inserted or reset by id. */
async function upsertUsers(tx: Tx, users: typeof DEMO_USERS, now: number) {
  const passwordHash = await demoPasswordHash()
  for (const u of users) {
    const data = { name: u.name, email: u.email, role: u.role, facilityId: u.facilityId, districtId: u.districtId, passwordHash, active: true, passwordChangedAt: now }
    await tx.user.upsert({ where: { id: u.id }, create: { id: u.id, ...data, createdAt: now }, update: data })
  }
}

const ADMINS = () => DEMO_USERS.filter((u) => u.role === 'district_admin')

/** Only the district admins and their districts (npm run seed:admin). */
export async function seedAdmins(deps: Deps) {
  const now = deps.clock()
  await write(deps.prisma, async (tx: Tx) => {
    await upsertAll(tx.district, DISTRICTS)
    await upsertUsers(tx, ADMINS(), now)
  })
}

/** One dashboard account per role. Demo only: every account shares DEMO_PASSWORD. */
export const DEMO_PASSWORD = 'Laafia-demo-2026'
export const DEMO_USERS = [
  { id: 'usr-0001', name: 'Nurudeen Abdul-Majeed', email: 'admin@laafia.demo', role: 'district_admin', facilityId: null, districtId: 'dist-sav', scope: 'Savelugu district' },
  { id: 'usr-0005', name: 'Osman Saaratu Deeshini', email: 'osman@laafia.demo', role: 'district_admin', facilityId: null, districtId: 'dist-sav', scope: 'Savelugu district' },
  { id: 'usr-0002', name: 'Dr. Fuseini Abdulai', email: 'supervisor@laafia.demo', role: 'supervisor', facilityId: null, districtId: 'dist-sav', scope: 'Savelugu district' },
  { id: 'usr-0003', name: 'Salamatu Iddrisu', email: 'hospital@laafia.demo', role: 'facility_staff', facilityId: 'fac-0003', districtId: null, scope: 'Savelugu Municipal Hospital' },
  { id: 'usr-0004', name: 'Rahinatu Mahama', email: 'healthcentre@laafia.demo', role: 'facility_staff', facilityId: 'fac-0002', districtId: null, scope: 'Pong-Tamale Health Centre' },
]
// Hashed once per process: the tests re-seed before every case.
let demoHash: Promise<string> | null = null
const demoPasswordHash = () => (demoHash ??= hashPassword(DEMO_PASSWORD))

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deps = buildDeps()
  const admins = process.argv[2] === 'admins'
  if (admins) await seedAdmins(deps)
  else {
    const s = await seedDemo(deps)
    console.log(`seeded ${s.facilities.length} facilities, ${s.households.length} households, ${s.clients.length} clients, ${s.visits.length} visits`)
    console.log('activation codes (valid 7 days, single use; re-run seed to reset):')
    for (const d of s.devices) console.log(`  ${DEMO_CODES[d.id]}  ${d.id}  ${d.role.padEnd(9)} ${d.user_name} (${d.facility_code})`)
  }
  console.log(`dashboard users (password for all: ${DEMO_PASSWORD}):`)
  for (const u of admins ? ADMINS() : DEMO_USERS) console.log(`  ${u.email.padEnd(26)} ${u.role.padEnd(15)} ${u.name} (${u.scope})`)
  if (!admins) {
    const a = await seedActivity(deps)
    console.log(`demo activity: ${a.referrals} referrals with events, device syncs, SMS log, audit`)
  }
  await deps.prisma.$disconnect()
}
