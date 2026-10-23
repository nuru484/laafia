import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from './text'
import { Button } from './kit'
import { color, font, radius, space } from './theme'

type Ask = { title: string; body?: string; confirm: string; cancel?: string | null; tone?: 'primary' | 'refer' }
type Pending = Ask & { resolve: (ok: boolean) => void }

let show: ((p: Pending) => void) | null = null

/**
 * Asks before an action that cannot be taken back. Resolves true on the confirm button, false on cancel or the
 * back button. `cancel: null` makes it a one-button notice.
 */
export function confirm(ask: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(true)
    show({ ...ask, resolve })
  })
}

export function ConfirmHost() {
  const [p, setP] = useState<Pending | null>(null)
  useEffect(() => {
    show = setP
    return () => { show = null }
  }, [])
  const close = (ok: boolean) => {
    p?.resolve(ok)
    setP(null)
  }
  return (
    <Modal visible={!!p} transparent animationType="fade" statusBarTranslucent onRequestClose={() => close(false)}>
      <Pressable style={st.scrim} onPress={() => p?.cancel !== null && close(false)} accessibilityLabel="Dismiss">
        {p ? (
          <Pressable style={st.sheet} onPress={() => undefined} accessibilityViewIsModal>
            <Text style={st.title} accessibilityRole="header">{p.title}</Text>
            {p.body ? <Text style={st.body}>{p.body}</Text> : null}
            <View style={st.actions}>
              <Button label={p.confirm} tone={p.tone ?? 'primary'} onPress={() => close(true)} />
              {p.cancel !== null ? <Button label={p.cancel ?? 'Cancel'} tone="plain" onPress={() => close(false)} /> : null}
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(14, 27, 34, 0.55)', justifyContent: 'center', padding: space.xl },
  sheet: { backgroundColor: color.card, borderRadius: radius, padding: space.xl, gap: space.md },
  title: { fontSize: font.title, fontWeight: '700', color: color.text },
  body: { fontSize: font.body, lineHeight: 23, color: color.muted },
  actions: { gap: space.sm, marginTop: space.sm },
})
