import { readSheet } from 'read-excel-file/node'
import type { Env } from '../../config/env.ts'
import { HttpError } from '../../platform/http/errors.ts'
import type { Logger } from '../../platform/logger.ts'
import type { Dhis2Input, Field, ImportIssue, ImportRow } from './imports.schemas.ts'

/*
 * Import sources and normalisation, no database access: CSV, XLSX and DHIS2
 * Tracker records become raw header -> value maps, then a template turns them
 * into normalised rows plus row-level errors.
 */

export type Raw = Record<string, string | null>
export const MAX_ROWS = 20_000
const DAY = 86_400_000

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


/**
 * DHIS2 Tracker API (2.41+): GET /api/tracker/trackedEntities, paged with
 * pager.nextPage. Each record exposes attributes by UID and by display name,
 * plus @trackedEntity, @orgUnit and @enrolledAt (first enrollment).
 * Credentials come from DHIS2_BASE_URL / DHIS2_USERNAME / DHIS2_PASSWORD (one district per deployment).
 */
export async function dhis2Records(env: Env, logger: Logger, q: Dhis2Input): Promise<Raw[]> {
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
      logger.warn('dhis2_failed', { status: res?.status ?? 'network', page })
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

