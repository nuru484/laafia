import { randomUUID } from 'node:crypto'
import { Prisma, write, type Tx } from '../../platform/db.ts'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { facilityByCode } from '../referrals/index.ts'
import type { Dhis2Input, ImportIssue, ImportRow, TemplateInput } from './imports.schemas.ts'
import { dhis2Records, mapRecords, tabularRecords, type Raw } from './imports.sources.ts'

/*
 * Register import pipeline (spec 9): source records (CSV, XLSX or DHIS2
 * Tracker) -> saved mapping template -> normalised rows -> validation and
 * dedupe -> preview batch (dry run) -> commit in one transaction -> undo.
 * GHS registers are national standard forms, so one template serves every CHPS.
 */

const MAX_ISSUES = 2_000

const templateView = (t: { id: string; name: string; source: string; mapping: unknown; constants: unknown; createdAt: number }) => ({
  id: t.id, name: t.name, source: t.source, mapping: t.mapping, constants: t.constants, created_at: t.createdAt,
})

export async function createTemplate(deps: Deps, body: TemplateInput) {
  const exists = await deps.prisma.mappingTemplate.findUnique({ where: { name: body.name }, select: { id: true } })
  if (exists) throw new HttpError(409, 'conflict', 'A template with that name exists')
  try {
    return templateView(await deps.prisma.mappingTemplate.create({ data: { id: randomUUID(), ...body, createdAt: deps.clock() } }))
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new HttpError(409, 'conflict', 'A template with that name exists')
    throw e
  }
}

export async function listTemplates(deps: Deps) {
  return (await deps.prisma.mappingTemplate.findMany({ orderBy: { name: 'asc' } })).map(templateView)
}

async function template(deps: Deps, id: string) {
  const t = await deps.prisma.mappingTemplate.findUnique({ where: { id } })
  if (!t) throw new HttpError(404, 'not_found', 'Unknown template')
  return { ...t, mapping: t.mapping as Record<string, string>, constants: t.constants as Record<string, string> }
}

// --- Dedupe: DHIS2 UID first, else name + dob + household (community and head name), against the database and within the batch.

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const personKey = (r: ImportRow) => `${norm(r.client.name)}|${r.client.dob ?? ''}|${norm(r.household.community)}|${norm(r.household.head_name)}`

async function dedupe(tx: Tx, facilityId: string, rows: ImportRow[]) {
  const uids = rows.map((r) => r.client.dhis2_uid).filter((u): u is string => !!u)
  const uidRows = uids.length ? await tx.client.findMany({ where: { dhis2Uid: { in: uids }, deleted: false }, select: { id: true, dhis2Uid: true } }) : []
  const byUid = new Map(uidRows.map((c) => [c.dhis2Uid!, c.id]))
  const existing = await tx.client.findMany({ where: { facilityId, deleted: false }, select: { id: true, name: true, dob: true, householdId: true } })
  const homes = await tx.household.findMany({ where: { id: { in: [...new Set(existing.map((c) => c.householdId))] } }, select: { id: true, community: true, headName: true } })
  const homeOf = new Map(homes.map((h) => [h.id, h]))
  const byPerson = new Map<string, string>(existing.flatMap((c) => {
    const h = homeOf.get(c.householdId) // an orphan client (household not synced yet) cannot match on household
    return h ? [[`${norm(c.name)}|${c.dob ?? ''}|${norm(h.community)}|${norm(h.headName)}`, c.id] as [string, string]] : []
  }))
  const seen = new Map<string, number>()
  const fresh: ImportRow[] = []
  const issues: ImportIssue[] = []
  for (const r of rows) {
    const uidHit = r.client.dhis2_uid ? byUid.get(r.client.dhis2_uid) : undefined
    const key = r.client.dhis2_uid ? `uid:${r.client.dhis2_uid}` : personKey(r)
    const personHit = r.client.dhis2_uid ? undefined : byPerson.get(key)
    if (uidHit) issues.push({ row: r.row, kind: 'duplicate', message: `same DHIS2 UID as an existing client`, match_id: uidHit })
    else if (personHit) issues.push({ row: r.row, kind: 'duplicate', message: 'same name, date of birth and household as an existing client', match_id: personHit })
    else if (seen.has(key)) issues.push({ row: r.row, kind: 'duplicate', message: `same person as row ${seen.get(key)} in this file` })
    else {
      seen.set(key, r.row)
      fresh.push(r)
    }
  }
  return { fresh, issues }
}

// --- Batches

type Batch = {
  id: string; facilityId: string; templateId: string | null; source: string; filename: string | null; status: string
  counts: unknown; issues: unknown; rows: unknown; createdIds: unknown; createdAt: number; committedAt: number | null; undoneAt: number | null
}
export const batchView = (b: Batch) => ({
  id: b.id, facility_id: b.facilityId, template_id: b.templateId, source: b.source, filename: b.filename, status: b.status,
  counts: b.counts, issues: b.issues, sample: (b.rows as ImportRow[]).slice(0, 20), created_at: b.createdAt, committed_at: b.committedAt, undone_at: b.undoneAt,
})

async function preview(deps: Deps, o: { facilityId: string; templateId: string; source: 'csv' | 'xlsx' | 'dhis2'; filename: string | null; records: Raw[] }) {
  const t = await template(deps, o.templateId)
  if ((t.source === 'dhis2') !== (o.source === 'dhis2')) throw new HttpError(400, 'invalid_request', `Template is for ${t.source} sources`)
  const mapped = mapRecords(o.records, t)
  const { fresh, issues } = await dedupe(deps.prisma, o.facilityId, mapped.rows)
  const all = [...mapped.issues, ...issues].sort((a, b) => a.row - b.row)
  const errorRows = new Set(mapped.issues.map((i) => i.row)).size
  const counts = { rows: o.records.length, valid: fresh.length, errors: errorRows, duplicates: issues.length, households: new Set(fresh.map((r) => r.household.key)).size }
  const b = await deps.prisma.importBatch.create({
    data: { id: randomUUID(), facilityId: o.facilityId, templateId: t.id, source: o.source, filename: o.filename, counts, issues: all.slice(0, MAX_ISSUES), rows: fresh, createdAt: deps.clock() },
  })
  return batchView(b)
}

export async function previewFile(deps: Deps, o: { templateId: string; facilityCode: string; file: Buffer; filename: string }) {
  const f = await facilityByCode(deps, o.facilityCode)
  const { source, records } = await tabularRecords(o.file, o.filename)
  return preview(deps, { facilityId: f.id, templateId: o.templateId, source, filename: o.filename.slice(0, 200), records })
}

export async function previewDhis2(deps: Deps, q: Dhis2Input) {
  const f = await facilityByCode(deps, q.facility_code)
  const records = await dhis2Records(deps.env, deps.logger, q)
  return preview(deps, { facilityId: f.id, templateId: q.template_id, source: 'dhis2', filename: null, records })
}

/** Inside write(): the global write lock serialises commits and undos, so a status read here cannot race. */
async function batchIn(tx: Tx, id: string, status: string) {
  const b = await tx.importBatch.findUnique({ where: { id } })
  if (!b) throw new HttpError(404, 'not_found', 'Unknown import batch')
  if (b.status !== status) throw new HttpError(409, 'conflict', `Batch is ${b.status}`)
  return b
}

/** Writes the previewed rows in one transaction. Dedupe runs again, since the register may have changed since the preview. */
export async function commit(deps: Deps, id: string) {
  return write(deps.prisma, async (tx) => {
    const b = await batchIn(tx, id, 'preview')
    const { fresh, issues } = await dedupe(tx, b.facilityId, b.rows as ImportRow[])
    const now = deps.clock()
    const stamp = { updatedAt: now, deviceId: 'import', deleted: false, facilityId: b.facilityId }
    const existingHh = await tx.household.findMany({ where: { facilityId: b.facilityId, deleted: false }, select: { id: true, community: true, headName: true } })
    const hhIds = new Map(existingHh.map((h) => [`${norm(h.community)}|${norm(h.headName)}`, h.id]))
    // Register codes use their own RG- prefix so they never collide with codes phones generate (CL-).
    const codes = await tx.client.findMany({ where: { code: { startsWith: 'RG-' } }, select: { code: true } })
    let next = Math.max(0, ...codes.map((c) => (/^RG-(\d{1,6})$/.exec(c.code)?.[1] ? Number(/^RG-(\d{1,6})$/.exec(c.code)![1]) : 0)))
    const created = { households: [] as string[], clients: [] as string[] }
    const newHouseholds: Prisma.HouseholdCreateManyInput[] = []
    const newClients: Prisma.ClientCreateManyInput[] = []
    for (const r of fresh) {
      const hhKey = r.household.key.startsWith('ref:') ? r.household.key : `${norm(r.household.community)}|${norm(r.household.head_name)}`
      let hh = hhIds.get(hhKey)
      if (!hh) {
        hh = randomUUID()
        hhIds.set(hhKey, hh)
        const h = r.household
        newHouseholds.push({ ...stamp, id: hh, community: h.community, headName: h.head_name, landmark: h.landmark, lat: h.lat, lng: h.lng, consentAt: null })
        created.households.push(hh)
      }
      const cid = randomUUID()
      next += 1
      const c = r.client
      newClients.push({
        ...stamp, id: cid, householdId: hh, code: `RG-${String(next).padStart(4, '0')}`, name: c.name, type: c.type, sex: c.sex, dob: c.dob, edd: c.edd,
        deliveryDate: c.delivery_date, parity: c.parity, nhisActive: c.nhis_active, dhis2Uid: c.dhis2_uid, priorComplications: [], riskFlags: [],
      })
      created.clients.push(cid)
    }
    for (let i = 0; i < newHouseholds.length; i += 500) await tx.household.createMany({ data: newHouseholds.slice(i, i + 500) })
    for (let i = 0; i < newClients.length; i += 500) await tx.client.createMany({ data: newClients.slice(i, i + 500) })
    const counts = { ...(b.counts as Record<string, number>), clients_created: created.clients.length, households_created: created.households.length, duplicates_at_commit: issues.length }
    const done = await tx.importBatch.update({
      where: { id },
      data: { status: 'committed', committedAt: now, createdIds: created, counts, issues: [...(b.issues as ImportIssue[]), ...issues].slice(0, MAX_ISSUES) },
    })
    return batchView(done)
  })
}

/**
 * Soft-deletes what the batch created (phones receive the deletes on their next
 * pull). Rows edited since the import, and households that gained other
 * clients, are kept and counted.
 */
export async function undo(deps: Deps, id: string) {
  return write(deps.prisma, async (tx) => {
    const b = await batchIn(tx, id, 'committed')
    const created = b.createdIds as { households: string[]; clients: string[] }
    const now = deps.clock()
    const untouched = { deviceId: 'import', updatedAt: b.committedAt!, deleted: false }
    const delClients = created.clients.length
      ? (await tx.client.updateMany({ where: { id: { in: created.clients }, ...untouched }, data: { deleted: true, updatedAt: now } })).count
      : 0
    const stillUsed = new Set((await tx.client.findMany({ where: { householdId: { in: created.households }, deleted: false }, select: { householdId: true } })).map((c) => c.householdId))
    const delHouseholds = created.households.length
      ? (await tx.household.updateMany({ where: { id: { in: created.households.filter((h) => !stillUsed.has(h)) }, ...untouched }, data: { deleted: true, updatedAt: now } })).count
      : 0
    const done = await tx.importBatch.update({ where: { id }, data: { status: 'undone', undoneAt: now } })
    return {
      batch: batchView(done),
      undone: { clients: delClients, households: delHouseholds },
      kept: { clients: created.clients.length - delClients, households: created.households.length - delHouseholds },
    }
  })
}

export async function getBatch(deps: Deps, id: string) {
  const b = /^[0-9a-f-]{36}$/i.test(id) ? await deps.prisma.importBatch.findUnique({ where: { id } }) : null
  if (!b) throw new HttpError(404, 'not_found', 'Unknown import batch')
  return batchView(b)
}

export async function listBatches(deps: Deps, facilityCode?: string) {
  const facilityId = facilityCode ? (await facilityByCode(deps, facilityCode)).id : undefined
  const rows = await deps.prisma.importBatch.findMany({ where: facilityId ? { facilityId } : {}, orderBy: { createdAt: 'desc' }, take: 100 })
  return rows.map((b) => ({ ...batchView(b), issues: undefined, sample: undefined }))
}
