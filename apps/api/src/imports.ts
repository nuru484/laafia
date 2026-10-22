import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { readSheet } from 'read-excel-file/node'
import { z } from 'zod'
import { db, write, type Tx } from './db.ts'
import { env } from './env.ts'
import { HttpError, log } from './http.ts'
import { clients, households, import_batches, mapping_templates, type ImportIssue, type ImportRow } from './schema.ts'

/*
 * Register import pipeline (spec 9): source records (CSV, XLSX or DHIS2
 * Tracker) -> saved mapping template -> normalised rows -> validation and
 * dedupe -> preview batch (dry run) -> commit in one transaction -> undo.
 * GHS registers are national standard forms, so one template serves every CHPS.
 */

export const TARGET_FIELDS = ['household_ref', 'community', 'head_name', 'landmark', 'lat', 'lng', 'name', 'type', 'sex', 'dob', 'edd', 'delivery_date', 'parity', 'nhis_active', 'dhis2_uid'] as const
type Field = (typeof TARGET_FIELDS)[number]
type Raw = Record<string, string | null>

const MAX_ROWS = 20_000
const MAX_ISSUES = 2_000
const DAY = 86_400_000

export const TemplateBody = z.object({
  name: z.string().min(1).max(120),
  source: z.enum(['tabular', 'dhis2']),
  mapping: z.partialRecord(z.enum(TARGET_FIELDS), z.string().min(1).max(200)),
  constants: z.partialRecord(z.enum(TARGET_FIELDS), z.string().max(200)).default({}),
})

export async function createTemplate(body: z.infer<typeof TemplateBody>) {
  const [t] = await db.insert(mapping_templates).values({ id: randomUUID(), ...body, mapping: body.mapping as Record<string, string>, constants: body.constants as Record<string, string>, created_at: Date.now() })
    .onConflictDoNothing().returning()
  if (!t) throw new HttpError(409, 'conflict', 'A template with that name exists')
  return t
}

async function template(id: string) {
  const [t] = await db.select().from(mapping_templates).where(eq(mapping_templates.id, id))
  if (!t) throw new HttpError(404, 'not_found', 'Unknown template')
  return t
}

// --- Sources

export const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } })

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') field += '"', i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field), rows.push(row), (row = []), (field = '')
    } else field += c
  }
  if (field !== '' || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

const cell = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  return s === '' ? null : s
}

function toRecords(table: unknown[][]): Raw[] {
  const [header, ...body] = table
  if (!header) return []
  const keys = header.map((h) => cell(h) ?? '')
  if (body.length > MAX_ROWS) throw new HttpError(413, 'too_large', `At most ${MAX_ROWS} rows per import`)
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, cell(r[i])])))
}

export async function tabularRecords(file: Buffer, filename: string): Promise<{ source: 'csv' | 'xlsx'; records: Raw[] }> {
  const isZip = file.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  if (isZip || /\.xlsx$/i.test(filename)) {
    const rows = await readSheet(file).catch(() => {
      throw new HttpError(415, 'unsupported_file', 'Could not read the XLSX file')
    })
    return { source: 'xlsx', records: toRecords(rows) }
  }
  const text = file.toString('utf8')
  if (!/\.(csv|txt)$/i.test(filename) || text.includes('\u0000')) throw new HttpError(415, 'unsupported_file', 'Upload a .csv or .xlsx file')
  return { source: 'csv', records: toRecords(parseCsv(text)) }
}

export const Dhis2Body = z.object({
  template_id: z.string().uuid(),
  facility_code: z.string().max(32),
  org_unit: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  program: z.string().regex(/^[A-Za-z0-9]{11}$/).optional(),
  tracked_entity_type: z.string().regex(/^[A-Za-z0-9]{11}$/).optional(),
  max_pages: z.number().int().min(1).max(100).default(50),
})

/**
 * DHIS2 Tracker API (2.41+): GET /api/tracker/trackedEntities, paged with
 * pager.nextPage. Each record exposes attributes by UID and by display name,
 * plus @trackedEntity, @orgUnit and @enrolledAt (first enrollment).
 * Credentials come from DHIS2_BASE_URL / DHIS2_USERNAME / DHIS2_PASSWORD (one district per deployment).
 */
export async function dhis2Records(q: z.infer<typeof Dhis2Body>): Promise<Raw[]> {
  if (!env.DHIS2_BASE_URL || !env.DHIS2_USERNAME || !env.DHIS2_PASSWORD) throw new HttpError(503, 'dhis2_unconfigured', 'DHIS2 is not configured on this server')
  if (!q.program && !q.tracked_entity_type) throw new HttpError(400, 'invalid_request', 'Give a program or a tracked_entity_type')
  const auth = 'Basic ' + Buffer.from(`${env.DHIS2_USERNAME}:${env.DHIS2_PASSWORD}`).toString('base64')
  const records: Raw[] = []
  const pageSize = 200
  for (let page = 1; page <= q.max_pages; page++) {
    const params = new URLSearchParams({
      orgUnits: q.org_unit, fields: 'trackedEntity,orgUnit,attributes[attribute,displayName,value],enrollments[enrolledAt,program]',
      pageSize: String(pageSize), page: String(page),
    })
    if (q.program) params.set('program', q.program)
    if (q.tracked_entity_type) params.set('trackedEntityType', q.tracked_entity_type)
    const res = await fetch(`${env.DHIS2_BASE_URL.replace(/\/$/, '')}/api/tracker/trackedEntities?${params}`, {
      headers: { Authorization: auth, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
    }).catch(() => null)
    if (!res?.ok) {
      log('warn', 'dhis2_failed', { status: res?.status ?? 'network', page })
      throw new HttpError(502, 'dhis2_error', `DHIS2 request failed (${res?.status ?? 'network'})`)
    }
    const body = (await res.json()) as { trackedEntities?: Dhis2Te[]; instances?: Dhis2Te[]; pager?: { nextPage?: string } }
    const list = body.trackedEntities ?? body.instances ?? []
    for (const te of list) {
      const r: Raw = { '@trackedEntity': te.trackedEntity, '@orgUnit': te.orgUnit ?? null, '@enrolledAt': cell(te.enrollments?.[0]?.enrolledAt?.slice(0, 10)) }
      for (const a of te.attributes ?? []) r[a.attribute] = r[a.displayName ?? a.attribute] = cell(a.value)
      records.push(r)
    }
    if (records.length > MAX_ROWS) throw new HttpError(413, 'too_large', `At most ${MAX_ROWS} records per import`)
    // 2.41+ marks more pages with pager.nextPage; without a pager, a short page is the last.
    if (!(body.pager ? !!body.pager.nextPage : list.length === pageSize)) break
  }
  return records
}
type Dhis2Te = { trackedEntity: string; orgUnit?: string; attributes?: { attribute: string; displayName?: string; value?: string }[]; enrollments?: { enrolledAt?: string }[] }

// --- Mapping and normalisation

/** Day-first dates as GHS registers write them (15/02/2027), ISO dates, and Excel serial numbers. */
export function parseDate(v: string): number | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v)
  if (m) return validDate(+m[3]!, +m[2]!, +m[1]!)
  if (/^\d{4,5}(\.\d+)?$/.test(v)) return Math.round((Number(v) - 25569) * DAY)
  return null
}
function validDate(y: number, mo: number, d: number) {
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null
}

const SEX: Record<string, 'f' | 'm'> = { f: 'f', female: 'f', girl: 'f', w: 'f', woman: 'f', m: 'm', male: 'm', boy: 'm', man: 'm' }
const TYPE: Record<string, string> = {
  pregnant: 'pregnant', anc: 'pregnant', pw: 'pregnant', postpartum: 'postpartum', pnc: 'postpartum', pp: 'postpartum',
  newborn: 'newborn', nb: 'newborn', neonate: 'newborn', child: 'child', ch: 'child', cwc: 'child', under5: 'child', 'under-five': 'child',
}
const YES = new Set(['yes', 'y', 'true', '1', 'active', 'valid'])

function lookup(r: Raw, key: string): string | null {
  if (key in r) return r[key] ?? null
  const k = key.trim().toLowerCase()
  const hit = Object.keys(r).find((h) => h.trim().toLowerCase() === k)
  return hit ? (r[hit] ?? null) : null
}

/** A mapping value "First name+Last name" joins several source columns with a space. */
function value(r: Raw, t: { mapping: Record<string, string>; constants: Record<string, string> }, f: Field): string | null {
  const src = t.mapping[f]
  if (src) {
    const parts = src.split('+').map((p) => lookup(r, p)).filter((p): p is string => !!p)
    if (parts.length) return parts.join(' ')
  }
  return t.constants[f]?.trim() || null
}

export function mapRecords(records: Raw[], t: { source: string; mapping: Record<string, string>; constants: Record<string, string> }) {
  const rows: ImportRow[] = []
  const issues: ImportIssue[] = []
  records.forEach((r, i) => {
    const row = i + 1
    const errs: ImportIssue[] = []
    const err = (field: Field, message: string) => errs.push({ row, kind: 'error', field, message })
    const v = (f: Field) => value(r, t, f)
    const date = (f: Field) => {
      const s = v(f)
      if (!s) return null
      const d = parseDate(s)
      if (d === null) err(f, `not a date: ${s}`)
      return d
    }
    const num = (f: Field, int = false) => {
      const s = v(f)
      if (!s) return null
      const n = Number(s)
      if (!Number.isFinite(n) || (int && !Number.isInteger(n))) return err(f, `not a number: ${s}`), null
      return n
    }
    const name = v('name')
    if (!name) err('name', 'required')
    const typeRaw = v('type')
    const type = typeRaw ? TYPE[typeRaw.toLowerCase()] : undefined
    if (!type) err('type', typeRaw ? `unknown type: ${typeRaw}` : 'required (map it or set a constant)')
    const community = v('community')
    if (!community) err('community', 'required')
    const sexRaw = v('sex')
    const sex = sexRaw ? (SEX[sexRaw.toLowerCase()] ?? null) : null
    if (sexRaw && !sex) err('sex', `unknown sex: ${sexRaw}`)
    const dob = date('dob')
    const edd = date('edd')
    const delivery_date = date('delivery_date')
    const parity = num('parity', true)
    const lat = num('lat')
    const lng = num('lng')
    if (lat !== null && (lat < -90 || lat > 90)) err('lat', 'out of range')
    if (lng !== null && (lng < -180 || lng > 180)) err('lng', 'out of range')
    if (type === 'pregnant' && edd === null && !errs.some((e) => e.field === 'edd')) err('edd', 'required for pregnant clients')
    if (type === 'postpartum' && delivery_date === null && !errs.some((e) => e.field === 'delivery_date')) err('delivery_date', 'required for postpartum clients')
    if ((type === 'newborn' || type === 'child') && dob === null && !errs.some((e) => e.field === 'dob')) err('dob', 'required for newborns and children')
    const dhis2 = t.source === 'dhis2' ? (v('dhis2_uid') ?? lookup(r, '@trackedEntity')) : v('dhis2_uid')
    if (errs.length) return void issues.push(...errs)
    const head_name = v('head_name') ?? name!
    const ref = v('household_ref')
    rows.push({
      row,
      household: { key: (ref ? `ref:${ref}` : `${community}|${head_name}`).toLowerCase(), community: community!, head_name, landmark: v('landmark') ?? '', lat, lng },
      client: { name: name!, type: type!, sex, dob, edd, delivery_date, parity, nhis_active: YES.has((v('nhis_active') ?? '').toLowerCase()), dhis2_uid: dhis2 },
    })
  })
  return { rows, issues }
}

// --- Dedupe: DHIS2 UID first, else name + dob + household (community and head name), against the database and within the batch.

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const personKey = (r: ImportRow) => `${norm(r.client.name)}|${r.client.dob ?? ''}|${norm(r.household.community)}|${norm(r.household.head_name)}`

async function dedupe(q: Tx | typeof db, facilityId: string, rows: ImportRow[]) {
  const uids = rows.map((r) => r.client.dhis2_uid).filter((u): u is string => !!u)
  const byUid = new Map((uids.length ? await q.select({ id: clients.id, uid: clients.dhis2_uid }).from(clients).where(and(inArray(clients.dhis2_uid, uids), eq(clients.deleted, false))) : []).map((c) => [c.uid!, c.id]))
  const existing = await q.select({ id: clients.id, name: clients.name, dob: clients.dob, community: households.community, head: households.head_name })
    .from(clients).innerJoin(households, eq(households.id, clients.household_id))
    .where(and(eq(clients.facility_id, facilityId), eq(clients.deleted, false)))
  const byPerson = new Map(existing.map((c) => [`${norm(c.name)}|${c.dob ?? ''}|${norm(c.community)}|${norm(c.head)}`, c.id]))
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

type Batch = typeof import_batches.$inferSelect
export const batchView = (b: Batch) => ({
  id: b.id, facility_id: b.facility_id, template_id: b.template_id, source: b.source, filename: b.filename, status: b.status,
  counts: b.counts, issues: b.issues, sample: b.rows.slice(0, 20), created_at: b.created_at, committed_at: b.committed_at, undone_at: b.undone_at,
})

export async function preview(o: { facilityId: string; templateId: string; source: 'csv' | 'xlsx' | 'dhis2'; filename: string | null; records: Raw[] }) {
  const t = await template(o.templateId)
  if ((t.source === 'dhis2') !== (o.source === 'dhis2')) throw new HttpError(400, 'invalid_request', `Template is for ${t.source} sources`)
  const mapped = mapRecords(o.records, t)
  const { fresh, issues } = await dedupe(db, o.facilityId, mapped.rows)
  const all = [...mapped.issues, ...issues].sort((a, b) => a.row - b.row)
  const errorRows = new Set(mapped.issues.map((i) => i.row)).size
  const counts = { rows: o.records.length, valid: fresh.length, errors: errorRows, duplicates: issues.length, households: new Set(fresh.map((r) => r.household.key)).size }
  const [b] = await db.insert(import_batches).values({
    id: randomUUID(), facility_id: o.facilityId, template_id: t.id, source: o.source, filename: o.filename, counts, issues: all.slice(0, MAX_ISSUES), rows: fresh, created_at: Date.now(),
  }).returning()
  return batchView(b!)
}

async function lockBatch(tx: Tx, id: string, status: Batch['status']) {
  const [b] = await tx.select().from(import_batches).where(eq(import_batches.id, id)).for('update')
  if (!b) throw new HttpError(404, 'not_found', 'Unknown import batch')
  if (b.status !== status) throw new HttpError(409, 'conflict', `Batch is ${b.status}`)
  return b
}

/** Writes the previewed rows in one transaction. Dedupe runs again, since the register may have changed since the preview. */
export async function commit(id: string) {
  return write(async (tx) => {
    const b = await lockBatch(tx, id, 'preview')
    const { fresh, issues } = await dedupe(tx, b.facility_id, b.rows)
    const now = Date.now()
    const stamp = { updated_at: now, device_id: 'import', deleted: false, facility_id: b.facility_id }
    const existingHh = await tx.select({ id: households.id, community: households.community, head: households.head_name }).from(households)
      .where(and(eq(households.facility_id, b.facility_id), eq(households.deleted, false)))
    const hhIds = new Map(existingHh.map((h) => [`${norm(h.community)}|${norm(h.head)}`, h.id]))
    // Register codes use their own RG- prefix so they never collide with codes phones generate (CL-).
    const [{ n }] = (await tx.execute<{ n: string }>(sql`select coalesce(max(substring(code from 4)::int), 0) as n from clients where code ~ '^RG-[0-9]{1,6}$'`)).rows as [{ n: string }]
    let next = Number(n)
    const created = { households: [] as string[], clients: [] as string[] }
    const newHouseholds: (typeof households.$inferInsert)[] = []
    const newClients: (typeof clients.$inferInsert)[] = []
    for (const r of fresh) {
      const hhKey = r.household.key.startsWith('ref:') ? r.household.key : `${norm(r.household.community)}|${norm(r.household.head_name)}`
      let hh = hhIds.get(hhKey)
      if (!hh) {
        hh = randomUUID()
        hhIds.set(hhKey, hh)
        const { key: _k, ...h } = r.household
        newHouseholds.push({ ...stamp, id: hh, ...h, consent_at: null })
        created.households.push(hh)
      }
      const cid = randomUUID()
      next += 1
      newClients.push({ ...stamp, id: cid, household_id: hh, code: `RG-${String(next).padStart(4, '0')}`, ...r.client, prior_complications: [], risk_flags: [] } as typeof clients.$inferInsert)
      created.clients.push(cid)
    }
    for (let i = 0; i < newHouseholds.length; i += 500) await tx.insert(households).values(newHouseholds.slice(i, i + 500))
    for (let i = 0; i < newClients.length; i += 500) await tx.insert(clients).values(newClients.slice(i, i + 500))
    const counts = { ...b.counts, clients_created: created.clients.length, households_created: created.households.length, duplicates_at_commit: issues.length }
    const [done] = await tx.update(import_batches).set({ status: 'committed', committed_at: now, created_ids: created, counts, issues: [...b.issues, ...issues].slice(0, MAX_ISSUES) })
      .where(eq(import_batches.id, id)).returning()
    return batchView(done!)
  })
}

/**
 * Soft-deletes what the batch created (phones receive the deletes on their next
 * pull). Rows edited since the import, and households that gained other
 * clients, are kept and counted.
 */
export async function undo(id: string) {
  return write(async (tx) => {
    const b = await lockBatch(tx, id, 'committed')
    const now = Date.now()
    const untouched = (t: typeof clients | typeof households) => and(eq(t.device_id, 'import'), eq(t.updated_at, b.committed_at!), eq(t.deleted, false))
    const delClients = b.created_ids.clients.length
      ? await tx.update(clients).set({ deleted: true, updated_at: now }).where(and(inArray(clients.id, b.created_ids.clients), untouched(clients))).returning({ id: clients.id })
      : []
    const delHouseholds = b.created_ids.households.length
      ? await tx.update(households).set({ deleted: true, updated_at: now }).where(and(inArray(households.id, b.created_ids.households), untouched(households),
        sql`not exists (select 1 from clients c where c.household_id = ${households.id} and not c.deleted)`)).returning({ id: households.id })
      : []
    const [done] = await tx.update(import_batches).set({ status: 'undone', undone_at: now }).where(eq(import_batches.id, id)).returning()
    return {
      batch: batchView(done!),
      undone: { clients: delClients.length, households: delHouseholds.length },
      kept: { clients: b.created_ids.clients.length - delClients.length, households: b.created_ids.households.length - delHouseholds.length },
    }
  })
}

export async function getBatch(id: string) {
  const [b] = z.string().uuid().safeParse(id).success ? await db.select().from(import_batches).where(eq(import_batches.id, id)) : []
  if (!b) throw new HttpError(404, 'not_found', 'Unknown import batch')
  return batchView(b)
}

export async function listBatches(facilityId?: string) {
  const rows = await db.select().from(import_batches).where(facilityId ? eq(import_batches.facility_id, facilityId) : undefined).orderBy(desc(import_batches.created_at)).limit(100)
  return rows.map((b) => ({ ...batchView(b), issues: undefined, sample: undefined }))
}

export async function listTemplates() {
  return db.select().from(mapping_templates).orderBy(mapping_templates.name)
}
