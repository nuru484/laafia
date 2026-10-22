import * as Location from 'expo-location'

export type Fix = { lat: number; lng: number; accuracy: number }

/**
 * A doorstep position from several fixes (spec 9): collect for up to `ms`,
 * keep the better half by accuracy, and average them. One fix on a cheap
 * phone is often 30 m off; the average of the good ones is usually under 10 m.
 */
export async function captureHouse(ms = 12_000, onFix?: (n: number, best: number) => void): Promise<Fix | null> {
  const { granted } = await Location.requestForegroundPermissionsAsync()
  if (!granted) return null
  const fixes: Fix[] = []
  const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (p) => {
    fixes.push({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 99 })
    onFix?.(fixes.length, Math.min(...fixes.map((f) => f.accuracy)))
  })
  await new Promise((r) => setTimeout(r, ms))
  sub.remove()
  if (!fixes.length) return null
  const good = [...fixes].sort((a, b) => a.accuracy - b.accuracy).slice(0, Math.max(1, Math.ceil(fixes.length / 2)))
  const avg = (k: 'lat' | 'lng') => good.reduce((s, f) => s + f[k], 0) / good.length
  return { lat: +avg('lat').toFixed(6), lng: +avg('lng').toFixed(6), accuracy: Math.round(good.reduce((s, f) => s + f.accuracy, 0) / good.length) }
}
