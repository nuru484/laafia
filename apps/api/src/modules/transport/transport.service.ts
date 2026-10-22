import { normalizePhone, transportRequestText } from '@laafia/core'
import { randomUUID } from 'node:crypto'
import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import { audit, districtOfFacility } from '../../platform/audit.ts'
import type { Actor, Device } from '../../platform/middleware/auth.ts'
import { assertFacility, facilityScope, inScope } from '../../platform/scope.ts'
import { facilityByCode, mayAct } from '../referrals/index.ts'
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

// --- Dashboard: district admins manage providers for any facility in their district.

export async function adminListProviders(deps: Deps, actor: Actor) {
  const scope = await facilityScope(deps, actor)
  const rows = await deps.prisma.transportProvider.findMany({ where: { deleted: false, ...(scope === null ? {} : { facilityId: { in: scope } }) }, orderBy: [{ community: 'asc' }, { name: 'asc' }] })
  const codes = new Map((await deps.prisma.facility.findMany({ select: { id: true, code: true } })).map((f) => [f.id, f.code]))
  return rows.map((r) => ({ ...toWire(r), facility_code: r.facilityId ? (codes.get(r.facilityId) ?? null) : null }))
}

export async function adminCreateProvider(deps: Deps, actor: Actor, body: ProviderInput & { facility_code: string }) {
  const f = await facilityByCode(deps, body.facility_code)
  await assertFacility(deps, actor, f.id)
  const now = deps.clock()
  const row = await write(deps.prisma, (tx) =>
    tx.transportProvider.create({
      data: { id: body.id ?? randomUUID(), name: body.name, phone: normalizePhone(body.phone), vehicle: body.vehicle, community: body.community, active: body.active, facilityId: f.id, deviceId: 'web', updatedAt: now },
    }),
  )
  await audit(deps, actor, 'provider.create', { type: 'transport_provider', id: row.id, districtId: f.districtId }, { facility: f.code })
  return toWire(row)
}

export async function adminUpdateProvider(deps: Deps, actor: Actor, id: string, patch: ProviderPatchInput) {
  const scope = await facilityScope(deps, actor)
  const now = deps.clock()
  const row = await write(deps.prisma, async (tx) => {
    const current = await tx.transportProvider.findUnique({ where: { id } })
    if (!current || current.deleted || !inScope(scope, current.facilityId)) return null
    return tx.transportProvider.update({ where: { id }, data: { ...patch, ...(patch.phone ? { phone: normalizePhone(patch.phone) } : {}), deviceId: 'web', updatedAt: now } })
  })
  if (!row) throw new HttpError(404, 'not_found', 'Unknown provider')
  await audit(deps, actor, patch.active === false ? 'provider.retire' : 'provider.update', { type: 'transport_provider', id, districtId: await districtOfFacility(deps, row.facilityId) }, { fields: Object.keys(patch) })
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
