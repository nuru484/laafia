import * as Location from 'expo-location'

export type Fix = { lat: number; lng: number; accuracy: number }

/** Enough fixes this good end the capture early. */
const GOOD_M = 20
const ENOUGH = 5

/**
 * A doorstep position from several fixes (spec 9): collect until five are
 * within 20 m or `maxMs` passes, keep the better half by accuracy, and average
 * them. GPS needs no internet, but without data the phone cannot download the
 * satellite almanac, so the first fix can take a minute outdoors.
 */
export async function captureHouse(maxMs = 90_000, onFix?: (n: number, best: number) => void): Promise<Fix | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync()
  if (!granted) return null
  const fixes: Fix[] = []
  let done = () => {}
  const finished = new Promise<void>((resolve) => { done = resolve })
  const timer = setTimeout(done, maxMs)
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (p) => {
    fixes.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 99 })
    onFix?.(fixes.length, Math.min(...fixes.map((f) => f.accuracy)))
    if (fixes.filter((f) => f.accuracy <= GOOD_M).length >= ENOUGH) done()
  })
  await finished
  clearTimeout(timer)
  sub.remove()
  if (!fixes.length) return null
  const good = [...fixes].sort((a, b) => a.accuracy - b.accuracy).slice(0, Math.max(1, Math.ceil(fixes.length / 2)))
  const avg = (k: 'lat' | 'lng') => good.reduce((s, f) => s + f[k], 0) / good.length
  return { lat: +avg('lat').toFixed(6), lng: +avg('lng').toFixed(6), accuracy: Math.round(good.reduce((s, f) => s + f.accuracy, 0) / good.length) }
}
