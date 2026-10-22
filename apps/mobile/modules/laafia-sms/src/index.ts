import { requireNativeModule, type EventSubscription } from 'expo-modules-core'

export type AppMode = 'cho' | 'volunteer' | 'facility'
export type Sim = { subscriptionId: number; slot: number; carrier: string | null }
export type RawSms = { from: string; body: string; receivedAt: number }
export type SendResult = { id: string; status: 'sent' | 'failed' | 'delivered'; error: string | null; at: number }
export type PowerStatus = {
  manufacturer: string
  model: string
  sdk: number
  ignoringBatteryOptimizations: boolean
  canUseFullScreenIntent: boolean
  notificationsEnabled: boolean
  verifierOk: boolean
}

type Native = {
  setMode(mode: AppMode): boolean
  setKeys(keys: Record<string, string>): void
  setWatchedNumbers(numbers: string[]): void
  getSims(): Sim[]
  send(to: string, body: string, id: string, subscriptionId: number | null): number
  drainReceived(): RawSms[]
  drainResults(): SendResult[]
  readInbox(sinceMs: number): Promise<RawSms[]>
  powerStatus(): PowerStatus
  requestIgnoreBatteryOptimizations(): boolean
  openFullScreenIntentSettings(): boolean
  openAutostartSettings(): string
  addListener(event: 'onSmsReceived' | 'onSmsStatus', listener: () => void): EventSubscription
}

export const LaafiaSms = requireNativeModule<Native>('LaafiaSms')
