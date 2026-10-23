import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState, type ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Activate } from '../features/Activate'
import { Pin } from '../features/Pin'
import { isUnlocked, onLockChange, setUnlocked } from '../lib/lock'
import { boot, currentSession, subscribe } from '../lib/runtime'
import { hasPin } from '../lib/session'
import { Banner, Loading, Screen } from '../ui/kit'
import { color } from '../ui/theme'
import { ConfirmHost } from '../ui/confirm'
import { FONTS } from '../ui/text'
import { ToastHost } from '../ui/toast'

type Gate = 'booting' | 'unactivated' | 'set_pin' | 'locked' | 'ready' | { error: string }

export default function RootLayout() {
  const [gate, setGate] = useState<Gate>('booting')
  // Local files, so this takes a moment; if they cannot load the app carries on in the system font.
  const [fontsLoaded, fontError] = useFonts(FONTS)

  async function decide() {
    try {
      const state = await boot()
      if (state === 'unactivated') return setGate('unactivated')
      if (!(await hasPin())) return setGate('set_pin')
      setGate(isUnlocked() ? 'ready' : 'locked')
    } catch (e) {
      setGate({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    void decide()
    const offLock = onLockChange((u) => { if (!u) setGate((g) => (g === 'ready' ? 'locked' : g)) })
    // Remote deactivation or a PIN wipe clears the session: fall back to activation.
    const offChange = subscribe(() => { if (!currentSession()) setGate('unactivated') })
    return () => { offLock(); offChange() }
  }, [])

  const unlock = () => { setUnlocked(true); setGate('ready') }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      {fontsLoaded || fontError ? gated(gate, setGate, unlock) : null}
      <ToastHost />
      <ConfirmHost />
    </GestureHandlerRootView>
  )
}

function gated(gate: Gate, setGate: (g: Gate) => void, unlock: () => void): ReactNode {
  if (gate === 'booting') return <Loading label="Opening Laafia" />
  if (typeof gate === 'object') return <Screen title="Laafia could not start"><Banner tone="refer" text={gate.error} /></Screen>
  if (gate === 'unactivated') return <Activate onDone={() => setGate('set_pin')} />
  if (gate === 'set_pin') return <Pin mode="setup" onDone={unlock} />
  if (gate === 'locked') return <Pin mode="unlock" name={currentSession()?.user_name} onDone={unlock} />
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
}
