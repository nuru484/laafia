import { randomBytes, randomInt } from 'node:crypto'
import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import { facilityByCode } from '../referrals/index.ts'
import type { CreateDeviceInput } from './admin.schemas.ts'

const ACTIVATION_TTL_MS = 48 * 3_600_000
const publicDevice = (d: object) => toWire(d, ['seq', 'keyHex'])

export async function listDevices(deps: Deps) {
  return (await deps.prisma.device.findMany({ orderBy: { id: 'asc' } })).map(publicDevice)
}

/** Registers a device and issues its one-time 8-digit activation code (spec 18.1, 48 h). */
export async function createDevice(deps: Deps, body: CreateDeviceInput) {
  const f = await facilityByCode(deps, body.facility_code)
  const now = deps.clock()
  const id = body.id ?? body.role[0]!.toUpperCase() + randomBytes(3).toString('hex').toUpperCase()
  const code = String(randomInt(10_000_000, 100_000_000))
  const expires_at = now + ACTIVATION_TTL_MS
  const device = await write(deps.prisma, async (tx) => {
    if (await tx.device.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(409, 'conflict', 'Device id already exists')
    const d = await tx.device.create({ data: { id, role: body.role, userName: body.user_name, phoneNumber: body.phone_number ?? null, facilityId: f.id, updatedAt: now } })
    await tx.activationCode.create({ data: { code, deviceId: id, expiresAt: expires_at } })
    return d
  })
  return { device: publicDevice(device), activation_code: code, expires_at }
}

/** Its next request gets 401 deactivated; facility phones drop its key on their next pull. */
export async function deactivateDevice(deps: Deps, id: string) {
  const d = await write(deps.prisma, async (tx) => {
    const updated = await tx.device.updateMany({ where: { id }, data: { active: false, updatedAt: deps.clock() } })
    return updated.count ? tx.device.findUnique({ where: { id } }) : null
  })
  if (!d) throw new HttpError(404, 'not_found', 'Unknown device')
  return { device: publicDevice(d) }
}
