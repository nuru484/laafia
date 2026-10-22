import type { Facility, FacilityLevel } from './types.ts'

export type Point = { lat: number; lng: number }

export function haversineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export type Stop = { id: string; community: string; lat: number | null; lng: number | null }

/**
 * Walkable order (spec 6.6): nearest-neighbour from the compound, finishing a
 * community before moving to the next. Stops without a GPS fix go last.
 * Greedy nearest-neighbour without 2-opt; adequate for the dozen stops in a day.
 */
export function planRoute(stops: Stop[], origin: Point): string[] {
  const left = stops.filter((s): s is Stop & Point => s.lat !== null && s.lng !== null)
  const order: string[] = []
  let here: Point = origin
  let community: string | null = null
  while (left.length) {
    const pool = left.some((s) => s.community === community) ? left.filter((s) => s.community === community) : left
    let best = pool[0]!
    for (const s of pool) if (haversineKm(here, s) < haversineKm(here, best)) best = s
    order.push(best.id)
    left.splice(left.indexOf(best), 1)
    here = best
    community = best.community
  }
  return [...order, ...stops.filter((s) => s.lat === null || s.lng === null).map((s) => s.id)]
}

/**
 * Resolve a protocol destination query (spec 7.4): `nearest:<level>` or
 * `nearest:capability:<cap>`. A missing capability falls back to the nearest
 * hospital, then to anything, so a referral always has somewhere to go.
 */
export function resolveDestination(query: string, facilities: Facility[], from: Point): Facility | null {
  const nearest = (list: Facility[]) =>
    list.reduce<Facility | null>((best, f) => (!best || haversineKm(from, f) < haversineKm(from, best) ? f : best), null)
  const cap = query.match(/^nearest:capability:(.+)$/)?.[1]
  const level = query.match(/^nearest:(chps|health_centre|hospital)$/)?.[1] as FacilityLevel | undefined
  const exact = cap ? facilities.filter((f) => f.capabilities.includes(cap)) : facilities.filter((f) => f.level === level)
  return nearest(exact) ?? nearest(facilities.filter((f) => f.level === 'hospital')) ?? nearest(facilities)
}
