import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { write, type Tx } from './platform/db.ts'
import { buildDeps, type Deps } from './platform/deps.ts'
import { GATEWAY_DEVICE } from './modules/referrals/index.ts'
import { hashPassword } from './platform/passwords.ts'

/*
 * Seeds what the dashboard cannot create for itself: the district, the
 * server's SMS gateway device, and the first district admin. Facilities,
 * nurses' phones and users are then created from the dashboard.
 *
 * Idempotent and non-destructive: re-running re-asserts the admin's role and
 * district but never changes a password, a district name or the gateway key.
 * Run it from a laptop against any database by setting DATABASE_URL.
 */

const NAMES = ['SEED_ADMIN_NAME', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_DISTRICT_CODE', 'SEED_DISTRICT_NAME'] as const
export type SeedConfig = Record<(typeof NAMES)[number], string>

/** The seed variables, or an error naming every missing one. */
export function seedConfig(env: Record<string, string | undefined> = process.env): SeedConfig {
  const missing = NAMES.filter((n) => !env[n]?.trim())
  if (missing.length) throw new Error(`The seed needs these set: ${missing.join(', ')} (see apps/api/.env.example)`)
  const c = Object.fromEntries(NAMES.map((n) => [n, env[n]!.trim()])) as SeedConfig
  if (c.SEED_ADMIN_PASSWORD.length < 10) throw new Error('SEED_ADMIN_PASSWORD must be at least 10 characters')
  return { ...c, SEED_ADMIN_EMAIL: c.SEED_ADMIN_EMAIL.toLowerCase(), SEED_DISTRICT_CODE: c.SEED_DISTRICT_CODE.toUpperCase() }
}

/** The device the server signs its own SMS with. Its key is generated once and kept across re-seeds. */
export async function ensureGateway(tx: Tx, now: number) {
  await tx.device.upsert({
    where: { id: GATEWAY_DEVICE }, update: {},
    create: { id: GATEWAY_DEVICE, updatedAt: now, deviceId: 'seed', role: 'gateway', userName: 'SMS gateway', keyHex: randomBytes(32).toString('hex') },
  })
}

export async function seedAdmin(deps: Deps, c: SeedConfig) {
  const now = deps.clock()
  const passwordHash = await hashPassword(c.SEED_ADMIN_PASSWORD)
  return write(deps.prisma, async (tx) => {
    const district = await tx.district.upsert({
      where: { code: c.SEED_DISTRICT_CODE }, update: {},
      create: { id: randomUUID(), code: c.SEED_DISTRICT_CODE, name: c.SEED_DISTRICT_NAME },
    })
    await ensureGateway(tx, now)
    const admin = await tx.user.upsert({
      where: { email: c.SEED_ADMIN_EMAIL },
      update: { role: 'district_admin', districtId: district.id, facilityId: null, active: true },
      create: {
        id: randomUUID(), name: c.SEED_ADMIN_NAME, email: c.SEED_ADMIN_EMAIL, passwordHash, role: 'district_admin',
        districtId: district.id, active: true, passwordChangedAt: now, createdAt: now,
      },
    })
    return { district, admin }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deps = buildDeps()
  try {
    const { district, admin } = await seedAdmin(deps, seedConfig())
    console.log(`district ${district.code} (${district.name}); admin ${admin.email} can sign in to the dashboard`)
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await deps.prisma.$disconnect()
  }
}
