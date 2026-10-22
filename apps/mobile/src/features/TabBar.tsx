import { router, usePathname } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { currentSession } from '../lib/runtime'
import { color, font, touch } from '../ui/theme'

const TABS = {
  cho: [['/today', 'Today'], ['/referrals', 'Referrals'], ['/map', 'Map'], ['/more', 'More']],
  volunteer: [['/today', 'Today'], ['/referrals', 'Carrying'], ['/more', 'More']],
  facility: [['/inbox', 'Inbox'], ['/scan', 'Scan'], ['/more', 'More']],
} as const

export function TabBar() {
  const path = usePathname()
  const insets = useSafeAreaInsets()
  const tabs = TABS[currentSession()?.role ?? 'cho']
  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {tabs.map(([href, label]) => {
        const active = path === href
        return (
          <Pressable key={href} onPress={() => router.replace(href)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={st.tab}>
            <Text style={[st.label, active && st.active]}>{label}</Text>
            {active ? <View style={st.indicator} /> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const st = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: color.card, borderTopWidth: 1, borderTopColor: color.line },
  tab: { flex: 1, minHeight: touch + 8, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.body, color: color.muted, fontWeight: '600' },
  active: { color: color.primary, fontWeight: '800' },
  indicator: { marginTop: 4, height: 3, width: 28, borderRadius: 2, backgroundColor: color.primary },
})
