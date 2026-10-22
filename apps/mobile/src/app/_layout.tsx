import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Activate } from '../features/Activate'
import { Pin } from '../features/Pin'
import { isUnlocked, onLockChange, setUnlocked } from '../lib/lock'
import { boot, currentSession, subscribe } from '../lib/runtime'
import { hasPin } from '../lib/session'
import { Banner, Loading, Screen } from '../ui/kit'

type Gate = 'booting' | 'unactivated' | 'set_pin' | 'locked' | 'ready' | { error: string }

export default function RootLayout() {
  const [gate, setGate] = useState<Gate>('booting')

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

  if (gate === 'booting') return <Loading label="Opening Laafia" />
  if (typeof gate === 'object') return <Screen title="Laafia could not start"><Banner tone="refer" text={gate.error} /></Screen>
  if (gate === 'unactivated') return <Activate onDone={() => setGate('set_pin')} />
  if (gate === 'set_pin') return <Pin mode="setup" onDone={unlock} />
  if (gate === 'locked') return <Pin mode="unlock" name={currentSession()?.user_name} onDone={unlock} />
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  )
}
