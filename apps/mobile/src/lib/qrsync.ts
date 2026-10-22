import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { base32 } from '@laafia/core'
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { Env } from './relay'
import { applyPulled, collectUnsynced } from './sync'

/*
 * Record sharing between two phones with no network (spec 13.2): a CHV's
 * enrolments to the CHO, the CHO's visits to the compound. Unsynced rows are
 * deflated and shown as a loop of small QR frames:
 *
 *   LFQ|1|<share>|<index>|<count>|<base64 chunk>|<sha256 of payload, 8 hex>
 *
 * Frames can be scanned in any order; nothing is written until every frame is
 * in and the checksum matches. Received rows stay unsynced, so whichever phone
 * reaches internet first uploads them; the server dedupes by id.
 */

/** Small enough for a dense-but-readable QR on a cheap camera. */
export const FRAME_BYTES = 600

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function buildFrames(env: Env): Promise<string[]> {
  const records = await collectUnsynced(env, 2000, true)
  if (!records.length) return []
  const packed = deflateSync(strToU8(JSON.stringify({ v: 1, from: env.self.device_id, records })), { level: 9 })
  const check = bytesToHex(sha256(packed)).slice(0, 8)
  const b64 = toBase64(packed)
  const share = base32(env.random(4)).slice(0, 6)
  const count = Math.ceil(b64.length / FRAME_BYTES)
  return Array.from({ length: count }, (_, i) => `LFQ|1|${share}|${i}|${count}|${b64.slice(i * FRAME_BYTES, (i + 1) * FRAME_BYTES)}|${check}`)
}

const FRAME = /^LFQ\|1\|([A-Z2-7]{6})\|(\d{1,4})\|(\d{1,4})\|([A-Za-z0-9+/=]+)\|([0-9a-f]{8})$/

export class Receiver {
  private share: string | null = null
  private count = 0
  private check = ''
  private chunks = new Map<number, string>()

  /** True when the frame belongs to this share (new or repeated); false for junk or another share. */
  add(text: string): boolean {
    const m = FRAME.exec(text.trim())
    if (!m) return false
    const [, share, i, count, chunk, check] = m
    if (this.share === null) {
      this.share = share!
      this.count = Number(count)
      this.check = check!
    } else if (share !== this.share || Number(count) !== this.count || check !== this.check) {
      return false
    }
    const index = Number(i)
    if (index >= this.count) return false
    this.chunks.set(index, chunk!)
    return true
  }

  progress() {
    return { have: this.chunks.size, of: this.count }
  }
  complete() {
    return this.count > 0 && this.chunks.size === this.count
  }

  async apply(env: Env): Promise<{ rows: number; from: string }> {
    if (!this.complete()) throw new Error('Not all frames scanned yet')
    const packed = fromBase64(Array.from({ length: this.count }, (_, i) => this.chunks.get(i)!).join(''))
    if (bytesToHex(sha256(packed)).slice(0, 8) !== this.check) throw new Error('The records failed their checksum; scan the frames again')
    const payload = JSON.parse(strFromU8(inflateSync(packed))) as { from: string; records: { table: string; row: Record<string, unknown> }[] }
    await env.db.tx(async () => {
      for (const { table, row } of payload.records) {
        await applyPulled(env, table, row)
        await env.db.run(`UPDATE ${table} SET synced = 0 WHERE id = ?`, [row.id as string])
        if (table === 'referrals' && typeof row.lfr === 'string') {
          await env.db.run("UPDATE referrals SET wire = ? WHERE id = ? AND wire = ''", [row.lfr, row.id as string])
        }
      }
    })
    return { rows: payload.records.length, from: payload.from }
  }
}
