import { normalizePhone, transportRequestText } from '@laafia/core'
import { randomUUID } from 'node:crypto'
import { write, type Tx } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import { audit, districtOfFacility } from '../../platform/audit.ts'
import { enqueueSms } from '../../platform/jobs/worker.ts'
import type { Actor, Device } from '../../platform/middleware/auth.ts'
import { assertFacility, facilityScope, inScope } from '../../platform/scope.ts'
import { facilityByCode, mayAct, referralAtFacility, writeAndPublish } from '../referrals/index.ts'
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
    return createPickup(tx, now, { id: body.id, referral, provider, callbackPhone: device.phoneNumber, facilityId: device.facilityId, writer: device.id, scheduledFor: body.scheduled_for })
  })
  return toWire(row)
}

/** Records the request and texts the driver (core transportRequestText), held until 18 h before a scheduled pickup. */
async function createPickup(
  tx: Tx, now: number,
  o: { id?: string; referral: { id: string; clientId: string | null; destinationFacilityId: string | null; urgency: number | null; shortId: string }; provider: { id: string; phone: string }; callbackPhone: string | null; facilityId: string | null; writer: string; scheduledFor?: number },
) {
  const client = o.referral.clientId ? await tx.client.findUnique({ where: { id: o.referral.clientId }, select: { householdId: true } }) : null
  const home = client ? await tx.household.findUnique({ where: { id: client.householdId } }) : null
  const destination = o.referral.destinationFacilityId ? await tx.facility.findUnique({ where: { id: o.referral.destinationFacilityId }, select: { name: true } }) : null
  const text = transportRequestText({
    urgent: (o.referral.urgency ?? 1) >= 2,
    pickup: home?.landmark || home?.community || 'see CHO',
    destination_name: destination?.name ?? 'the facility',
    cho_phone: o.callbackPhone ?? '-',
    short_id: o.referral.shortId,
    lat: home?.lat ?? null,
    lng: home?.lng ?? null,
  })
  const created = await tx.transportRequest.create({
    data: { id: o.id ?? randomUUID(), referralId: o.referral.id, providerId: o.provider.id, status: 'requested', scheduledFor: o.scheduledFor ?? null, facilityId: o.facilityId, deviceId: o.writer, updatedAt: now },
  })
  const runAt = o.scheduledFor ? Math.max(now, o.scheduledFor - HOLD_MS) : now
  await enqueueSms(tx, now, o.provider.phone, text, { purpose: 'driver', facilityId: o.facilityId, runAt })
  return created
}

// --- Dashboard: facility staff arrange a pickup for a referral at their facility.

/** Active providers serving the client's community, else the origin catchment's, within the actor's district. */
async function providersFor(deps: Deps, db: Tx, referral: { facilityId: string | null; clientId: string | null }) {
  const client = referral.clientId ? await db.client.findUnique({ where: { id: referral.clientId }, select: { householdId: true } }) : null
  const home = client ? await db.household.findUnique({ where: { id: client.householdId }, select: { community: true } }) : null
  const where = { active: true, deleted: false }
  const local = home ? await db.transportProvider.findMany({ where: { ...where, community: { equals: home.community, mode: 'insensitive' as const } }, orderBy: { name: 'asc' } }) : []
  const catchment = referral.facilityId ? await db.transportProvider.findMany({ where: { ...where, facilityId: referral.facilityId }, orderBy: { name: 'asc' } }) : []
  const seen = new Set<string>()
  return { community: home?.community ?? null, providers: [...local, ...catchment].filter((p) => !seen.has(p.id) && seen.add(p.id)) }
}

export async function transportOptions(deps: Deps, actor: Actor, referralId: string) {
  const { referral } = await referralAtFacility(deps, deps.prisma, actor, referralId)
  const { community, providers } = await providersFor(deps, deps.prisma, referral)
  return { community, providers: providers.map((p) => toWire(p)) }
}

export async function requestTransportFromWeb(deps: Deps, actor: Actor, referralId: string, body: { provider_id: string; scheduled_for?: number }) {
  const now = deps.clock()
  let created: Awaited<ReturnType<typeof createPickup>> | null = null
  await writeAndPublish(deps, async (tx, touched) => {
    const { referral, scope } = await referralAtFacility(deps, tx, actor, referralId)
    const { providers } = await providersFor(deps, tx, referral)
    const provider = providers.find((p) => p.id === body.provider_id)
    if (!provider) throw new HttpError(404, 'not_found', 'Unknown provider for this referral')
    // The staff member's facility phone is the callback number; the request belongs to the origin catchment so the CHO phone syncs it.
    const here = scope?.[0] ? await tx.facility.findUnique({ where: { id: scope[0] }, select: { phone: true } }) : null
    created = await createPickup(tx, now, {
      referral, provider, callbackPhone: here?.phone ?? null, facilityId: referral.facilityId,
      writer: actor.kind === 'user' ? `web:${actor.user.id}` : 'WEB', scheduledFor: body.scheduled_for,
    })
    touched.add(referral.id)
  })
  await audit(deps, actor, 'transport.request', { type: 'transport_request', id: created!.id, districtId: await districtOfFacility(deps, created!.facilityId) }, { referral: referralId, provider: body.provider_id })
  return toWire(created!)
}
