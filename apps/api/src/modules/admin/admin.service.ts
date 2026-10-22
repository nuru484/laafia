import { randomBytes, randomInt } from 'node:crypto'
import { audit, districtOfFacility } from '../../platform/audit.ts'
import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { assertFacility, facilityScope, inScope } from '../../platform/scope.ts'
import { facilityByCode } from '../referrals/index.ts'
import type { CreateDeviceInput } from './admin.schemas.ts'

const ACTIVATION_TTL_MS = 48 * 3_600_000
const publicDevice = (d: object) => toWire(d, ['seq', 'keyHex'])
const newCode = () => String(randomInt(10_000_000, 100_000_000))

/** Devices in scope with their last sync, app version and any unused activation code's expiry (never the code). */
export async function listDevices(deps: Deps, actor: Actor) {
  const scope = await facilityScope(deps, actor)
  const rows = await deps.prisma.device.findMany({
    where: scope === null ? {} : { facilityId: { in: scope } },
    include: { facility: { select: { code: true, name: true } }, activationCodes: { where: { usedAt: null }, select: { expiresAt: true }, orderBy: { expiresAt: 'desc' }, take: 1 } },
    orderBy: { id: 'asc' },
  })
  const status = new Map((await deps.prisma.deviceStatus.findMany({ where: { deviceId: { in: rows.map((d) => d.id) } } })).map((s) => [s.deviceId, s]))
  return rows.map(({ facility, activationCodes, ...d }) => ({
    ...publicDevice(d),
    facility_code: facility?.code ?? null,
    facility_name: facility?.name ?? null,
    last_sync_at: status.get(d.id)?.lastSyncAt ?? null,
    app_version: status.get(d.id)?.appVersion ?? null,
    activation_pending_until: activationCodes[0] && activationCodes[0].expiresAt > deps.clock() ? activationCodes[0].expiresAt : null,
  }))
}

/** Registers a device and issues its one-time 8-digit activation code (spec 18.1, 48 h). */
export async function createDevice(deps: Deps, actor: Actor, body: CreateDeviceInput) {
  const f = await facilityByCode(deps, body.facility_code)
  await assertFacility(deps, actor, f.id)
  const now = deps.clock()
  const id = body.id ?? body.role[0]!.toUpperCase() + randomBytes(3).toString('hex').toUpperCase()
  const code = newCode()
  const expires_at = now + ACTIVATION_TTL_MS
  const device = await write(deps.prisma, async (tx) => {
    if (await tx.device.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(409, 'conflict', 'Device id already exists')
    const d = await tx.device.create({ data: { id, role: body.role, userName: body.user_name, phoneNumber: body.phone_number ?? null, facilityId: f.id, updatedAt: now } })
    await tx.activationCode.create({ data: { code, deviceId: id, expiresAt: expires_at } })
    return d
  })
  await audit(deps, actor, 'device.create', { type: 'device', id, districtId: f.districtId }, { role: body.role, facility: f.code })
  return { device: publicDevice(device), activation_code: code, expires_at }
}

/**
 * A fresh activation code for a device (a new or replacement phone). Older unused codes stop working.
 * Activating again on a new phone keeps the device id and key, and reactivates a deactivated device.
 */
export async function reissueCode(deps: Deps, actor: Actor, id: string) {
  const scope = await facilityScope(deps, actor)
  const now = deps.clock()
  const code = newCode()
  const expires_at = now + ACTIVATION_TTL_MS
  const device = await write(deps.prisma, async (tx) => {
    const d = await tx.device.findUnique({ where: { id } })
    if (!d || d.role === 'gateway' || !inScope(scope, d.facilityId)) return null
    await tx.activationCode.updateMany({ where: { deviceId: id, usedAt: null }, data: { expiresAt: now } })
    await tx.activationCode.create({ data: { code, deviceId: id, expiresAt: expires_at } })
    return d.active ? d : tx.device.update({ where: { id }, data: { active: true, updatedAt: now } })
  })
  if (!device) throw new HttpError(404, 'not_found', 'Unknown device')
  await audit(deps, actor, 'device.code_reissue', { type: 'device', id, districtId: await districtOfFacility(deps, device.facilityId) })
  return { device: publicDevice(device), activation_code: code, expires_at }
}

/** Its next request gets 401 deactivated; facility phones drop its key on their next pull. */
export async function deactivateDevice(deps: Deps, actor: Actor, id: string) {
  const scope = await facilityScope(deps, actor)
  const d = await write(deps.prisma, async (tx) => {
    const target = await tx.device.findUnique({ where: { id }, select: { facilityId: true } })
    if (!target || !inScope(scope, target.facilityId)) return null
    const updated = await tx.device.updateMany({ where: { id }, data: { active: false, updatedAt: deps.clock() } })
    return updated.count ? tx.device.findUnique({ where: { id } }) : null
  })
  if (!d) throw new HttpError(404, 'not_found', 'Unknown device')
  await audit(deps, actor, 'device.deactivate', { type: 'device', id, districtId: await districtOfFacility(deps, d.facilityId) })
  return { device: publicDevice(d) }
}
