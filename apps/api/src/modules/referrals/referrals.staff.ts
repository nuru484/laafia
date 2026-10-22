import { PROTOCOLS, WIRE_TYPE, encode, protocolIdFor, shortIdFromBytes, signCodes, type ClientType, type ReferralMessage } from '@laafia/core'
import { randomBytes, randomUUID } from 'node:crypto'
import { audit } from '../../platform/audit.ts'
import type { Tx } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import { enqueueSms } from '../../platform/jobs/worker.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { facilityScope, inScope } from '../../platform/scope.ts'
import {
  GATEWAY_DEVICE, acknowledgeIfNoFacilityPhone, byId, facilityByCode, hasFacilityPhone, pushEvent, referralView, syncOnward, writeAndPublish, type Referral,
} from './referrals.service.ts'

/*
 * What a facility phone can do, from the dashboard, for staff at that facility (or the district admin).
 * Web actions are ordinary events, so forward-only status derivation merges them with the phone's.
 */

const sourceOf = (actor: Actor) => (actor.kind === 'user' ? `web:${actor.user.id}` : actor.kind === 'device' ? actor.device.id : 'WEB')

/** The referral if the patient is at (or bound for) a facility in the actor's scope, else 404. */
export async function referralAtFacility(deps: Deps, db: Tx, actor: Actor, id: string) {
  const scope = await facilityScope(deps, actor)
  const r = await byId(db, id)
  if (!r || !(inScope(scope, r.destinationFacilityId) || inScope(scope, r.facilityId))) throw new HttpError(404, 'not_found', 'Referral not found')
  return { referral: r, scope }
}

/** The LFR a facility phone needs to receive the onward referral by SMS, or null when a field cannot travel on the wire. */
function onwardLfr(child: Referral, destinationCode: string, keyHex: string): string | null {
  if (!child.clientCode || !child.clientType || !child.urgency) return null
  try {
    const protocol = PROTOCOLS[protocolIdFor(child.clientType as ClientType, null)]
    const names = (child.dangerSigns as string[]) ?? []
    let codes: string[]
    try {
      codes = signCodes(protocol, names)
    } catch {
      codes = names.filter((n) => /^[a-z]{2}$/.test(n)) // already wire codes (learned from an SMS)
    }
    const msg: ReferralMessage = {
      kind: 'LFR', signer: GATEWAY_DEVICE, short_id: child.shortId, client_code: child.clientCode, urgency: child.urgency as 1 | 2 | 3,
      client_type: WIRE_TYPE[child.clientType as ClientType], context: child.context ?? '-', sign_codes: codes, destination: destinationCode, next_of_kin: child.nextOfKin,
    }
    return encode(msg, keyHex)
  } catch {
    return null
  }
}

/**
 * Refer onward from the dashboard: a new referral from the gateway device (new short id, signed with its key),
 * parent_referral_id set. The destination's phone gets the LFR by SMS; its devices also get it on their next sync.
 * A destination with no phone in facility mode is acknowledged by the server, as for any referral.
 */
export async function referOnward(deps: Deps, actor: Actor, parentId: string, body: { destination_facility_code: string; urgency?: number }) {
  const dest = await facilityByCode(deps, body.destination_facility_code)
  const childId = randomUUID()
  await writeAndPublish(deps, async (tx, touched) => {
    const { referral: parent, scope } = await referralAtFacility(deps, tx, actor, parentId)
    if (!inScope(scope, parent.destinationFacilityId)) throw new HttpError(403, 'forbidden', 'Only the facility the patient was referred to can refer onward')
    if (dest.id === parent.destinationFacilityId) throw new HttpError(400, 'invalid_request', 'Choose a different facility')
    const gw = await tx.device.findUnique({ where: { id: GATEWAY_DEVICE } })
    if (!gw?.keyHex) throw new Error('no gateway device: run the seed')
    const now = deps.clock()
    let shortId = shortIdFromBytes(randomBytes(5))
    while (await tx.referral.findUnique({ where: { originDeviceId_shortId: { originDeviceId: GATEWAY_DEVICE, shortId } }, select: { id: true } })) shortId = shortIdFromBytes(randomBytes(5))
    const child = await tx.referral.create({
      data: {
        id: childId, originDeviceId: GATEWAY_DEVICE, shortId, facilityId: parent.destinationFacilityId, clientId: parent.clientId, visitId: parent.visitId,
        clientCode: parent.clientCode, clientType: parent.clientType, context: parent.context, urgency: body.urgency ?? parent.urgency,
        dangerSigns: (parent.dangerSigns as string[]) ?? [], destinationFacilityId: dest.id, nextOfKin: parent.nextOfKin, deliveredVia: 'https',
        parentReferralId: parent.id, status: 'created', updatedAt: now, deviceId: sourceOf(actor),
      },
    })
    touched.add(child.id)
    const source = sourceOf(actor)
    await pushEvent(tx, null, { id: randomUUID(), referral_id: child.id, origin_device_id: GATEWAY_DEVICE, short_id: shortId, status: 'sent', at: now, updated_at: now, source_device_id: source, via: 'https', device_id: source }, touched)
    await syncOnward(tx, (await byId(tx, child.id))!, touched)
    if (await hasFacilityPhone(tx, dest.id)) {
      const lfr = dest.phone ? onwardLfr(child, dest.code, gw.keyHex) : null
      if (lfr) await enqueueSms(tx, now, dest.phone!, lfr, `lfr:${child.id}`)
    } else {
      await acknowledgeIfNoFacilityPhone(tx, now, child, null, touched, 'https')
    }
  })
  await audit(deps, actor, 'referral.refer_onward', { type: 'referral', id: childId, districtId: dest.districtId }, { parent: parentId, destination: dest.code })
  return (await referralView(deps, childId))!
}

/** The referred client with household and recent visits, for staff receiving the patient. */
export async function clientForReferral(deps: Deps, actor: Actor, id: string) {
  const { referral: r } = await referralAtFacility(deps, deps.prisma, actor, id)
  const client = r.clientId
    ? await deps.prisma.client.findUnique({ where: { id: r.clientId } })
    : r.clientCode ? await deps.prisma.client.findFirst({ where: { code: r.clientCode, facilityId: r.facilityId, deleted: false } }) : null
  if (!client) return { client: null, household: null, visits: [] }
  const household = await deps.prisma.household.findUnique({ where: { id: client.householdId } })
  const visits = await deps.prisma.visit.findMany({ where: { clientId: client.id, deleted: false }, orderBy: { visitedAt: 'desc' }, take: 5 })
  return {
    client: toWire(client),
    household: household ? { community: household.community, head_name: household.headName, landmark: household.landmark, lat: household.lat, lng: household.lng } : null,
    visits: visits.map((v) => toWire(v)),
  }
}
