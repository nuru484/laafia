import { normalizePhone } from '@laafia/core'
import { randomBytes } from 'node:crypto'
import { audit } from '../../platform/audit.ts'
import { write } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { toWire } from '../../platform/http/wire.ts'
import type { Actor } from '../../platform/middleware/auth.ts'
import { districtOrThrow, facilityScope, inScope } from '../../platform/scope.ts'
import type { CreateFacilityInput, UpdateFacilityInput } from './facilities.schemas.ts'

/* Facilities are synced to phones (destinations, numbers to text), so every write bumps the row's seq. */

export async function listFacilities(deps: Deps, actor: Actor) {
  const scope = await facilityScope(deps, actor)
  const rows = await deps.prisma.facility.findMany({ where: scope === null ? {} : { id: { in: scope } }, include: { district: { select: { code: true } } }, orderBy: [{ level: 'asc' }, { name: 'asc' }] })
  return rows.map(({ district, ...f }) => ({ ...toWire(f), district_code: district?.code ?? null }))
}

export async function createFacility(deps: Deps, actor: Actor, body: CreateFacilityInput) {
  let districtId = actor.kind === 'user' ? districtOrThrow(actor) : null
  if (actor.kind !== 'user') {
    const d = body.district_code ? await deps.prisma.district.findUnique({ where: { code: body.district_code } }) : null
    if (!d) throw new HttpError(400, 'invalid_request', 'district_code is required')
    districtId = d.id
  }
  if (await deps.prisma.facility.findUnique({ where: { code: body.code }, select: { id: true } })) throw new HttpError(409, 'conflict', 'That facility code exists')
  const now = deps.clock()
  const f = await write(deps.prisma, (tx) =>
    tx.facility.create({
      data: {
        id: `fac-${randomBytes(4).toString('hex')}`, code: body.code, name: body.name, level: body.level, phone: body.phone ? normalizePhone(body.phone) : null,
        lat: body.lat, lng: body.lng, capabilities: body.capabilities, districtId, updatedAt: now, deviceId: 'web',
      },
    }),
  )
  await audit(deps, actor, 'facility.create', { type: 'facility', id: f.id, districtId }, { code: f.code })
  return toWire(f)
}

export async function updateFacility(deps: Deps, actor: Actor, id: string, patch: UpdateFacilityInput) {
  if (!inScope(await facilityScope(deps, actor), id)) throw new HttpError(404, 'not_found', 'Unknown facility')
  const now = deps.clock()
  const f = await write(deps.prisma, async (tx) => {
    const res = await tx.facility.updateMany({
      where: { id },
      data: { ...patch, ...(patch.phone !== undefined ? { phone: patch.phone ? normalizePhone(patch.phone) : null } : {}), updatedAt: now, deviceId: 'web' },
    })
    return res.count ? tx.facility.findUniqueOrThrow({ where: { id } }) : null
  })
  if (!f) throw new HttpError(404, 'not_found', 'Unknown facility')
  await audit(deps, actor, 'facility.update', { type: 'facility', id, districtId: f.districtId }, { fields: Object.keys(patch) })
  return toWire(f)
}
