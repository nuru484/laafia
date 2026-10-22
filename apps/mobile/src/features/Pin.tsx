import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { deactivateLocally } from '../lib/runtime'
import { checkPin, setPin } from '../lib/session'
import { color, font, space, touch } from '../ui/theme'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

/** Six-digit PIN pad. `setup` asks twice; unlock enforces the lockout and wipe rules in session.ts. */
export function Pin({ mode, onDone, name }: { mode: 'setup' | 'unlock'; onDone: () => void; name?: string }) {
  const [entry, setEntry] = useState('')
  const [first, setFirst] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        Alert.alert('Data wiped', 'Too many wrong PINs. The register has been removed from this phone; synced records are safe on the server. Activate again.')
        await deactivateLocally()
      }
    } finally {
      setBusy(false)
    }
  }

  function press(k: string) {
    if (busy) return
    if (k === 'del') { setEntry((e) => e.slice(0, -1)); return }
    if (!k || entry.length >= 6) return
    const next = entry + k
    setEntry(next)
    if (next.length === 6) void complete(next)
  }

  return (
    <SafeAreaView style={st.wrap}>
      <Text style={st.title} accessibilityRole="header">{title}</Text>
      <View style={st.dots} accessibilityLabel={`${entry.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => <View key={i} style={[st.dot, i < entry.length && st.dotOn]} />)}
      </View>
      <Text style={st.message} accessibilityLiveRegion="assertive">{busy ? 'Checking' : message ?? ' '}</Text>
      <View style={st.pad}>
        {KEYS.map((k, i) => (
          <Pressable key={i} disabled={!k} onPress={() => press(k)} accessibilityRole="button" accessibilityLabel={k === 'del' ? 'Delete' : k || undefined}
            style={({ pressed }) => [st.key, !k && { opacity: 0 }, pressed && { backgroundColor: color.line }]}>
            <Text style={st.keyText}>{k === 'del' ? 'Del' : k}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  )
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg },
  title: { fontSize: font.title, fontWeight: '700', color: color.text, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: space.md },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: color.primary },
  dotOn: { backgroundColor: color.primary },
  message: { minHeight: 44, color: color.refer, fontSize: font.body, textAlign: 'center' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 84 + 2 * space.md, gap: space.md },
  key: { width: 84, height: Math.max(touch, 64), borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.line },
  keyText: { fontSize: 24, fontWeight: '600', color: color.text },
})
