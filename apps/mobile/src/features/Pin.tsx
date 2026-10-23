import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Text } from '../ui/text'
import { SafeAreaView } from 'react-native-safe-area-context'
import { biometricOn, unlockWithBiometrics } from '../lib/biometric'
import { deactivateLocally } from '../lib/runtime'
import { checkPin, setPin } from '../lib/session'
import { confirm } from '../ui/confirm'
import { color, font, radius, space, touch } from '../ui/theme'
import { Brand } from './Brand'

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** Six-digit PIN pad. `setup` asks twice; unlock enforces the lockout and wipe rules in session.ts, or takes a fingerprint or face. */
export function Pin({ mode, onDone, name }: { mode: 'setup' | 'unlock'; onDone: () => void; name?: string }) {
  const [entry, setEntry] = useState('')
  const [first, setFirst] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bio, setBio] = useState(false)
  const { width } = useWindowDimensions()
  const key = Math.min(88, Math.floor((width - 2 * space.xl - 2 * space.md) / 3))

  async function tryBiometrics() {
    if (await unlockWithBiometrics()) onDone()
  }
  useEffect(() => {
    if (mode !== 'unlock') return
    void biometricOn().then((on) => {
      setBio(on)
      if (on) void tryBiometrics()
    })
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const title = mode === 'setup' ? (first ? 'Enter the PIN again' : 'Choose a 6-digit PIN') : `Enter your PIN${name ? `, ${name.split(' ')[0]}` : ''}`

  async function complete(pin: string) {
    setBusy(true)
    try {
      if (mode === 'setup') {
        if (!first) { setFirst(pin); setEntry(''); setMessage(null); return }
        if (pin !== first) { setFirst(null); setEntry(''); setMessage('The two PINs did not match. Start again.'); return }
        await setPin(pin)
        onDone()
        return
      }
      const r = await checkPin(pin)
      setEntry('')
      if (r.result === 'ok') onDone()
      else if (r.result === 'wrong') setMessage(`Wrong PIN. ${r.remaining} tries left before this phone's data is wiped.`)
      else if (r.result === 'locked') setMessage(`Too many wrong PINs. Locked until ${new Date(r.until).toLocaleTimeString()}.`)
      else {
        await confirm({ title: 'Data wiped', body: 'Too many wrong PINs. The register has been removed from this phone; synced records are safe on the server. Activate the phone again.', confirm: 'OK', cancel: null })
        await deactivateLocally()
      }
    } finally {
      setBusy(false)
    }
  }

  function press(k: string) {
    if (busy || entry.length >= 6) return
    const next = entry + k
    setEntry(next)
    if (next.length === 6) void complete(next)
  }

  return (
    <SafeAreaView style={st.wrap}>
      <Brand size={56} />
      <View style={st.prompt}>
        <Text style={st.title} accessibilityRole="header">{title}</Text>
        <View style={st.dots} accessibilityLabel={`${entry.length} of 6 digits entered`}>
          {Array.from({ length: 6 }, (_, i) => <View key={i} style={[st.dot, i < entry.length && st.dotOn]} />)}
        </View>
        <Text style={st.message} accessibilityLiveRegion="assertive">{busy ? 'Checking' : message ?? ' '}</Text>
      </View>
      <View style={[st.pad, { width: 3 * key + 2 * space.md }]}>
        {DIGITS.map((d) => <Key key={d} width={key} busy={busy} label={d} onPress={() => press(d)}><Text style={st.keyText}>{d}</Text></Key>)}
        {bio ? (
          <Key width={key} busy={busy} label="Unlock with fingerprint or face" onPress={() => void tryBiometrics()}><Ionicons name="finger-print" size={28} color={color.primary} /></Key>
        ) : (
          <Key width={key} busy={busy} label="Clear" onPress={() => setEntry('')}><Ionicons name="close" size={26} color={color.muted} /></Key>
        )}
        <Key width={key} busy={busy} label="0" onPress={() => press('0')}><Text style={st.keyText}>0</Text></Key>
        <Key width={key} busy={busy} label="Delete" onPress={() => setEntry((e) => e.slice(0, -1))}><Ionicons name="backspace-outline" size={26} color={color.text} /></Key>
      </View>
    </SafeAreaView>
  )
}

function Key({ width, busy, label, onPress, children }: { width: number; busy: boolean; label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [st.key, { width }, pressed && { backgroundColor: color.primaryBg, borderColor: color.primary }]}>
      {children}
    </Pressable>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.xl },
  prompt: { alignItems: 'center', gap: space.md },
  title: { fontSize: font.title, fontWeight: '700', color: color.text, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: space.md },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: color.primary },
  dotOn: { backgroundColor: color.primary },
  message: { minHeight: 40, color: color.refer, fontSize: font.small + 1, textAlign: 'center' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  key: { height: Math.max(touch, 60), borderRadius: radius, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.line },
  keyText: { fontSize: 26, fontWeight: '600', color: color.text, fontVariant: ['tabular-nums'] },
})
