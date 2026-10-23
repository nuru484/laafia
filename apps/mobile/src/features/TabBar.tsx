import { Ionicons } from '@expo/vector-icons'
import { router, usePathname } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { currentSession } from '../lib/runtime'
import type { IconName } from '../ui/kit'
import { color, touch } from '../ui/theme'

type Tab = { href: '/today' | '/lookup' | '/referrals' | '/inbox' | '/more'; label: string; icon: IconName; active: IconName }

const TABS: Record<'cho' | 'facility', Tab[]> = {
  cho: [
    { href: '/today', label: 'Today', icon: 'calendar-clear-outline', active: 'calendar-clear' },
    { href: '/lookup', label: 'Clients', icon: 'people-outline', active: 'people' },
    { href: '/referrals', label: 'Referrals', icon: 'paper-plane-outline', active: 'paper-plane' },
    { href: '/more', label: 'More', icon: 'grid-outline', active: 'grid' },
  ],
  facility: [
    { href: '/inbox', label: 'Inbox', icon: 'file-tray-full-outline', active: 'file-tray-full' },
    { href: '/more', label: 'More', icon: 'grid-outline', active: 'grid' },
  ],
}

export function TabBar() {
  const path = usePathname()
  const insets = useSafeAreaInsets()
  const tabs = TABS[currentSession()?.role ?? 'cho']
  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = path === t.href
        return (
          <Pressable key={t.href} onPress={() => router.replace(t.href)} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }} style={st.tab}>
            <View style={[st.pill, on && st.pillOn]}>
              <Ionicons name={on ? t.active : t.icon} size={22} color={on ? color.primary : color.muted} />
            </View>
            <Text style={[st.label, on && st.labelOn]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const st = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: color.card, borderTopWidth: 1, borderTopColor: color.line, paddingTop: 8 },
  tab: { flex: 1, minHeight: touch + 8, alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: { width: 56, height: 30, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: color.primaryBg },
  label: { fontSize: 12, color: color.muted, fontWeight: '600' },
  labelOn: { color: color.primary, fontWeight: '700' },
})
