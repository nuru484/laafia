import { normalizePhone } from '@laafia/core'
import { randomBytes } from 'node:crypto'
import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import { deviceFromToken, issueToken, REFRESH_GRACE_S, type Device } from '../../platform/middleware/auth.ts'
import type { ActivateInput } from './auth.schemas.ts'

/**
 * Key directory (lead's policy): facility phones verify LFR from field devices,
 * so they get every active device's key (demo: no district scoping). CHO phones
 * verify LFS, so they get their district's facility device keys plus the SMS
 * gateway's. Volunteers get none: they carry scanned referrals unverified and
 * the receiving facility verifies them.
 */
export async function keysFor(deps: Deps, d: Device): Promise<Record<string, string> | undefined> {
  const live = { active: true, keyHex: { not: null } }
  let rows: { id: string; keyHex: string | null }[]
  if (d.role === 'facility') rows = await deps.prisma.device.findMany({ where: live, select: { id: true, keyHex: true } })
  else if (d.role === 'cho') {
    const home = d.facilityId ? await deps.prisma.facility.findUnique({ where: { id: d.facilityId }, select: { districtId: true } }) : null
    const facilityScope = home?.districtId ? { districtId: home.districtId } : { id: d.facilityId ?? '' }
    rows = await deps.prisma.device.findMany({
      where: { ...live, OR: [{ role: 'facility', facility: facilityScope }, { role: 'gateway' }] },
      select: { id: true, keyHex: true },
    })
  } else return undefined
  return Object.fromEntries(rows.map((r) => [r.id, r.keyHex!]))
}

async function profile(deps: Deps, d: Device) {
  const facility = d.facilityId ? await deps.prisma.facility.findUnique({ where: { id: d.facilityId } }) : null
  return { device_id: d.id, role: d.role, user_name: d.userName, phone_number: d.phoneNumber, facility: facility ? toWire(facility) : null }
}

export async function activate(deps: Deps, body: ActivateInput) {
  const now = deps.clock()
  const device = await write(deps.prisma, async (tx) => {
    // Guarded claim: only one request can mark an unused, unexpired code used.
    const claimed = await tx.activationCode.updateMany({ where: { code: body.activation_code, usedAt: null, expiresAt: { gte: now } }, data: { usedAt: now } })
    if (!claimed.count) throw new HttpError(400, 'invalid_code', 'Activation code is invalid, used or expired')
    const code = await tx.activationCode.findUniqueOrThrow({ where: { code: body.activation_code }, include: { device: true } })
    if (!code.device.active) throw new HttpError(401, 'deactivated', 'This device has been deactivated')
    // Seeded demo devices keep their deterministic key so phones and server agree offline.
    return tx.device.update({
      where: { id: code.deviceId },
      data: { keyHex: code.device.keyHex ?? randomBytes(32).toString('hex'), phoneNumber: normalizePhone(body.phone_number), activatedAt: now, updatedAt: now },
    })
  })
  return { device_id: device.id, device_key: device.keyHex!, jwt: await issueToken(deps, device), profile: await profile(deps, device), keys: await keysFor(deps, device) }
}

export async function refresh(deps: Deps, token: string) {
  const device = await deviceFromToken(deps, token, REFRESH_GRACE_S)
  return { jwt: await issueToken(deps, device) }
}
