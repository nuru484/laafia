import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from './text'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, font, radius, space } from './theme'

type Tone = 'ok' | 'error' | 'info'
type Item = { id: number; text: string; tone: Tone }

let nextId = 1
const listeners = new Set<(t: Item) => void>()

/** A short message above the tab bar. Callable from screens and from the background workers alike. */
export function toast(text: string, tone: Tone = 'ok') {
  const t = { id: nextId++, text, tone }
  for (const fn of listeners) fn(t)
}

const ICON = { ok: 'checkmark-circle', error: 'alert-circle', info: 'information-circle' } as const
const TINT = { ok: '#47CD89', error: '#F97066', info: color.accent } as const

export function ToastHost() {
  const [items, setItems] = useState<Item[]>([])
  const insets = useSafeAreaInsets()
  useEffect(() => {
    const add = (t: Item) => {
      setItems((xs) => [...xs.slice(-2), t])
      // Errors stay long enough to read twice.
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === 'error' ? 6000 : 3000)
    }
    listeners.add(add)
    return () => { listeners.delete(add) }
  }, [])
  const dismiss = (id: number) => setItems((xs) => xs.filter((x) => x.id !== id))
  return (
    <View pointerEvents="box-none" style={[st.host, { bottom: insets.bottom + 72 }]}>
      {items.map((t) => (
        <Animated.View key={t.id} entering={FadeInDown.duration(180)} exiting={FadeOutDown.duration(150)}>
          <Pressable onPress={() => dismiss(t.id)} style={st.toast} accessibilityRole="alert" accessibilityLiveRegion="polite" accessibilityHint="Tap to dismiss">
            <Ionicons name={ICON[t.tone]} size={20} color={TINT[t.tone]} />
            <Text style={st.text}>{t.text}</Text>
          </Pressable>
        </Animated.View>
      ))}
    </View>
  )
}

const st = StyleSheet.create({
  host: { position: 'absolute', left: space.lg, right: space.lg, gap: space.sm },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: color.text, borderRadius: radius },
  text: { flex: 1, color: '#F3F6F8', fontSize: font.body - 1, lineHeight: 21 },
})
