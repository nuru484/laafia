import NetInfo from '@react-native-community/netinfo'
import * as Crypto from 'expo-crypto'
import { AppState } from 'react-native'
import { LaafiaSms } from 'laafia-sms'
import { cancelAckAlarm } from './alarms'
import { ApiError, deviceApi, publicCall } from './api'
import type { Db } from './db/db'
import { openDb, wipeDb } from './db/expo'
import { applySendResult, dueMessages, markSending, processIncoming, referralStatus, type Env, type Role } from './relay'
import { clearSession, loadSession, saveSession, type Session } from './session'
import { pull, push } from './sync'

/*
 * One running app: the open database, the session, and the workers that move
 * SMS and sync. Screens read through `env()` and re-render on `subscribe`.
 */

let db: Db | null = null
let session: Session | null = null
let current: Env | null = null
const listeners = new Set<() => void>()
let stopWorkers: (() => void) | null = null
let syncing = false

export type SyncState = { last_ok: number | null; last_error: string | null; running: boolean }
let syncState: SyncState = { last_ok: null, last_error: null, running: false }

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function changed() {
  for (const fn of listeners) fn()
}

export function env(): Env {
  if (!current) throw new Error('app not activated')
  return current
}
export function currentSession(): Session | null {
  return session
}
export function getSyncState(): SyncState {
  return syncState
}

function buildEnv(database: Db, s: Session): Env {
  return {
    db: database,
    self: { device_id: s.device_id, role: s.role, key_hex: s.device_key, phone: s.phone_number },
    now: () => Date.now(),
    uuid: () => Crypto.randomUUID(),
    random: (n) => Crypto.getRandomBytes(n),
  }
}

const api = deviceApi(
  async () => session?.jwt ?? null,
  async (jwt) => {
    if (!session) return
    session = { ...session, jwt }
    await saveSession(session)
  },
)

export async function boot(): Promise<'unactivated' | 'ready'> {
  db ??= await openDb()
  session = await loadSession()
  if (!session) return 'unactivated'
  current = buildEnv(db, session)
  await pushNativeState()
  startWorkers()
  return 'ready'
}

export type ActivationProgress = { phase: 'activating' | 'downloading'; records: number }

/** First launch at the facility with internet (spec 18.1): exchange the code, then pull the catchment. */
export async function activate(code: string, phone: string, onProgress: (p: ActivationProgress) => void): Promise<void> {
  onProgress({ phase: 'activating', records: 0 })
  const res = await publicCall('POST', '/auth/activate', { activation_code: code.trim(), phone_number: phone.trim(), device_info: { app: 'laafia-mobile' } })
  const s: Session = {
    device_id: res.device_id, device_key: res.device_key, jwt: res.jwt, role: res.profile.role as Role,
    user_name: res.profile.user_name, phone_number: res.profile.phone_number, facility: res.profile.facility, activated_at: Date.now(),
  }
  db ??= await openDb()
  session = s
  await saveSession(s)
  current = buildEnv(db, s)
  if (res.keys) {
    for (const [id, key] of Object.entries(res.keys as Record<string, string>)) await db.run('UPDATE devices SET key_hex = ? WHERE id = ?', [key, id])
  }
  onProgress({ phase: 'downloading', records: 0 })
  let records = 0
  await pull(current, {
    request: async (method, path, body) => {
      const page = await api.request(method, path, body)
      records += page?.records?.length ?? 0
      onProgress({ phase: 'downloading', records })
      return page
    },
  })
  await pushNativeState()
  startWorkers()
  changed()
}

/** Copies what the SMS receiver needs when JavaScript is not running: mode, keys, and client numbers whose texts are bookings. */
export async function pushNativeState() {
  if (!current || !session) return
  const { db: d } = current
  const keys = await d.all<{ id: string; key_hex: string }>('SELECT id, key_hex FROM devices WHERE active = 1 AND key_hex IS NOT NULL')
  LaafiaSms.setKeys(Object.fromEntries(keys.map((k) => [k.id, k.key_hex])))
  const clients = session.role === 'cho' ? await d.all<{ phone: string }>('SELECT DISTINCT phone FROM clients WHERE phone IS NOT NULL AND deleted = 0') : []
  LaafiaSms.setWatchedNumbers(clients.map((c) => c.phone))
  LaafiaSms.setMode(session.role)
}

export async function sendDue(): Promise<void> {
  if (!current) return
  const due = await dueMessages(current)
  if (!due.length) return
  const sims = LaafiaSms.getSims()
  for (const msg of due) {
    const sim = sims.length ? sims[msg.sim_index % sims.length]!.subscriptionId : null
    await markSending(current, msg.id, msg.sim_index)
    try {
      LaafiaSms.send(msg.recipient, msg.body, msg.id, sim)
    } catch (e) {
      await applySendResult(current, { id: msg.id, status: 'failed', error: 'send_threw', at: Date.now() })
    }
  }
  changed()
}

export async function drainResults(): Promise<void> {
  if (!current) return
  const results = LaafiaSms.drainResults()
  for (const r of results) await applySendResult(current, r)
  if (results.length) changed()
}

const INBOX_SCAN_KEY = 'inbox_scan_at'

/** Messages queued by the native receiver, then a scan of the SMS inbox for any that arrived while the app was stopped. */
export async function drainInbox(): Promise<void> {
  if (!current) return
  const e = current
  let any = false
  const handle = async (m: { from: string; body: string; receivedAt: number }) => {
    const r = await processIncoming(e, { sender: m.from, body: m.body, received_at: m.receivedAt, via: 'sms' })
    if (r.kind === 'status' && r.referral_id) await cancelAckAlarm(e.db, r.referral_id)
    any ||= r.kind !== 'duplicate' && r.kind !== 'ignored'
  }
  for (const m of LaafiaSms.drainReceived()) await handle(m)
  const since = Number((await e.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [INBOX_SCAN_KEY]))?.value ?? session?.activated_at ?? Date.now())
  try {
    const missed = await LaafiaSms.readInbox(since)
    for (const m of missed) await handle(m)
    const newest = missed.length ? Math.max(since, ...missed.map((m) => m.receivedAt)) : since
    await e.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [INBOX_SCAN_KEY, String(newest)])
  } catch {
    // READ_SMS denied: the receiver queue still works; the onboarding checks flag the permission.
  }
  if (any) {
    await pushNativeState()
    await sendDue()
    changed()
  }
}

/** An acknowledgement that arrived by internet instead of SMS also silences the alarm. */
async function clearAnsweredAlarms(e: Env) {
  const armed = await e.db.all<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'ack_alarm_%'")
  for (const { key } of armed) {
    const referralId = key.slice('ack_alarm_'.length)
    const status = await referralStatus(e, referralId)
    if (!['created', 'sent'].includes(status)) await cancelAckAlarm(e.db, referralId)
  }
}

export async function syncNow(): Promise<SyncState> {
  if (!current || syncing) return syncState
  syncing = true
  syncState = { ...syncState, running: true }
  changed()
  try {
    await push(current, api)
    await pull(current, api)
    await clearAnsweredAlarms(current)
    await pushNativeState()
    syncState = { last_ok: Date.now(), last_error: null, running: false }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'deactivated') {
      await deactivateLocally()
      return syncState
    }
    syncState = { ...syncState, running: false, last_error: e instanceof ApiError && e.code === 'offline' ? 'No internet' : e instanceof Error ? e.message : String(e) }
  } finally {
    syncing = false
    changed()
  }
  return syncState
}

/** Remote deactivation or PIN wipe: drop the data and the identity; the phone returns to activation. */
export async function deactivateLocally(): Promise<void> {
  stopWorkers?.()
  stopWorkers = null
  current = null
  session = null
  db = null
  LaafiaSms.setMode('cho')
  LaafiaSms.setKeys({})
  await wipeDb()
  await clearSession()
  changed()
}

function startWorkers() {
  if (stopWorkers) return
  const subs = [
    LaafiaSms.addListener('onSmsReceived', () => void drainInbox()),
    LaafiaSms.addListener('onSmsStatus', () => void drainResults()),
  ]
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') void drainResults().then(drainInbox).then(sendDue)
  })
  const net = NetInfo.addEventListener((s) => {
    if (s.isInternetReachable) void syncNow()
  })
  const timers = [
    setInterval(() => void drainResults().then(sendDue), 15_000),
    setInterval(() => void drainInbox(), 60_000),
    setInterval(() => void NetInfo.fetch().then((s) => { if (s.isInternetReachable) void syncNow() }), 5 * 60_000),
  ]
  void drainResults().then(drainInbox).then(sendDue)
  stopWorkers = () => {
    subs.forEach((s) => s.remove())
    app.remove()
    net()
    timers.forEach(clearInterval)
  }
}
