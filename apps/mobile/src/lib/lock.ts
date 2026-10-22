import { AppState } from 'react-native'

/** The PIN screen comes back after the app has been in the background this long. */
const RELOCK_AFTER_MS = 5 * 60_000

let unlocked = false
let backgroundedAt: number | null = null
const listeners = new Set<(unlocked: boolean) => void>()

AppState.addEventListener('change', (state) => {
  if (state !== 'active') backgroundedAt ??= Date.now()
  else {
    if (backgroundedAt !== null && Date.now() - backgroundedAt > RELOCK_AFTER_MS) setUnlocked(false)
    backgroundedAt = null
  }
})

export function isUnlocked() {
  return unlocked
}
export function setUnlocked(value: boolean) {
  unlocked = value
  for (const fn of listeners) fn(value)
}
export function onLockChange(fn: (unlocked: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
