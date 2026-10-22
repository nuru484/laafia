import { normalizePhone, transportRequestText } from '@laafia/core'
import { randomUUID } from 'node:crypto'
import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import type { Device } from '../../platform/middleware/auth.ts'
import { mayAct } from '../referrals/index.ts'
import type { ProviderInput, ProviderPatchInput, RequestInput } from './transport.schemas.ts'

/* Transport providers and online pickup requests (spec 15). Rows are the same ones phones sync. */

const HOLD_MS = 18 * 3_600_000

export async function listProviders(deps: Deps, device: Device) {
  const rows = await deps.prisma.transportProvider.findMany({ where: { facilityId: device.facilityId ?? '', deleted: false }, orderBy: { name: 'asc' } })
  return rows.map((r) => toWire(r))
}

export async function createProvider(deps: Deps, device: Device, body: ProviderInput) {
  const now = deps.clock()
  const row = await write(deps.prisma, async (tx) => {
    const id = body.id ?? randomUUID()
    if (await tx.transportProvider.findUnique({ where: { id }, select: { id: true } })) throw new HttpError(409, 'conflict', 'Provider id already exists')
    return tx.transportProvider.create({
      data: { id, name: body.name, phone: normalizePhone(body.phone), vehicle: body.vehicle, community: body.community, active: body.active, facilityId: device.facilityId, deviceId: device.id, updatedAt: now },
    })
  })
  return toWire(row)
}

export async function updateProvider(deps: Deps, device: Device, id: string, patch: ProviderPatchInput) {
  const now = deps.clock()
  const row = await write(deps.prisma, async (tx) => {
    const data = { ...patch, ...(patch.phone ? { phone: normalizePhone(patch.phone) } : {}), deviceId: device.id, updatedAt: now }
    const res = await tx.transportProvider.updateMany({ where: { id, facilityId: device.facilityId ?? '', deleted: false }, data })
    return res.count ? tx.transportProvider.findUnique({ where: { id } }) : null
  })
  if (!row) throw new HttpError(404, 'not_found', 'Unknown provider')
  return toWire(row)
}

/**
 * A CHO with data asks the server to text the driver (the phone otherwise texts the driver itself).
 * A scheduled pickup is held until 18 h before `scheduled_for`.
 */
export async function requestTransport(deps: Deps, device: Device, body: RequestInput) {
  const now = deps.clock()
  const row = await write(deps.prisma, async (tx) => {
    const referral = await tx.referral.findUnique({ where: { id: body.referral_id } })
    if (!referral || !(await mayAct(tx, device, referral))) throw new HttpError(404, 'not_found', 'Unknown referral')
    const provider = await tx.transportProvider.findFirst({ where: { id: body.provider_id, facilityId: device.facilityId ?? '', active: true, deleted: false } })
    if (!provider) throw new HttpError(404, 'not_found', 'Unknown provider')
    const client = referral.clientId ? await tx.client.findUnique({ where: { id: referral.clientId }, select: { householdId: true } }) : null
    const home = client ? await tx.household.findUnique({ where: { id: client.householdId } }) : null
    const destination = referral.destinationFacilityId ? await tx.facility.findUnique({ where: { id: referral.destinationFacilityId }, select: { name: true } }) : null
    const text = transportRequestText({
      urgent: (referral.urgency ?? 1) >= 2,
      pickup: home?.landmark || home?.community || 'see CHO',
      destination_name: destination?.name ?? 'the facility',
      cho_phone: device.phoneNumber ?? '-',
      short_id: referral.shortId,
      lat: home?.lat ?? null,
      lng: home?.lng ?? null,
    })
    const created = await tx.transportRequest.create({
      data: { id: body.id ?? randomUUID(), referralId: referral.id, providerId: provider.id, status: 'requested', scheduledFor: body.scheduled_for ?? null, facilityId: device.facilityId, deviceId: device.id, updatedAt: now },
    })
    const runAt = body.scheduled_for ? Math.max(now, body.scheduled_for - HOLD_MS) : now
    await tx.job.create({ data: { kind: 'sms', payload: { to: provider.phone, body: text }, runAt, createdAt: now } })
    return created
  })
  return toWire(row)
}
