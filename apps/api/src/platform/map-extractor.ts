import { execFile } from 'node:child_process'
import type { Env } from '../config/env.ts'

/** [west, south, east, north] in degrees. */
export type Bbox = [number, number, number, number]

/** Cuts a district out of the planet map into a PMTiles file at `out`. Swapped for a fake in tests. */
export type MapExtractor = { extract(bbox: Bbox, out: string): Promise<{ source: string }> }

export const PROTOMAPS_BUILDS = 'https://build.protomaps.com'
/** Street level; Savelugu (about 55 x 55 km) comes to 7 MB. */
const MAX_ZOOM = 15
const TIMEOUT_MS = 20 * 60_000

/** Protomaps publishes a planet build daily and keeps about a week of them; the newest that exists wins. */
async function latestBuild(now: number) {
  for (let back = 0; back < 7; back++) {
    const url = `${PROTOMAPS_BUILDS}/${new Date(now - back * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')}.pmtiles`
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null)
    if (res?.ok) return url
  }
  throw new Error('No Protomaps planet build reachable from the last 7 days')
}

/**
 * Runs `pmtiles extract` (go-pmtiles, installed by scripts/get-pmtiles.sh). It reads the planet
 * archive's index over HTTP and downloads only the tiles inside the box, never the whole planet.
 */
export function createMapExtractor(env: Env, clock: () => number): MapExtractor {
  return {
    async extract(bbox, out) {
      const source = await latestBuild(clock())
      await new Promise<void>((ok, fail) =>
        execFile(env.PMTILES_BIN, ['extract', source, out, `--bbox=${bbox.join(',')}`, `--maxzoom=${MAX_ZOOM}`, '--quiet'], { timeout: TIMEOUT_MS }, (err, _stdout, stderr) => {
          if (!err) return ok()
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail(new Error('The pmtiles tool is not installed on the server (scripts/get-pmtiles.sh)'))
          fail(new Error(`pmtiles: ${stderr.trim().split('\n').at(-1) || err.message}`.slice(0, 300)))
        }),
      )
      return { source }
    },
  }
}
