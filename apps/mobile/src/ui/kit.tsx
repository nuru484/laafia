import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { color, font, radius, space, touch } from './theme'

export function Screen({ title, subtitle, right, children, scroll = true }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; scroll?: boolean }) {
  const body = scroll ? <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[s.body, { flex: 1 }]}>{children}</View>
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {body}
    </SafeAreaView>
  )
}

type Tone = 'primary' | 'refer' | 'plain' | 'quiet'
export function Button({ label, onPress, tone = 'primary', disabled, busy, icon, style, accessibilityHint }: { label: string; onPress: () => void; tone?: Tone; disabled?: boolean; busy?: boolean; icon?: string; style?: ViewStyle; accessibilityHint?: string }) {
  const bg = tone === 'primary' ? color.primary : tone === 'refer' ? color.refer : tone === 'plain' ? color.card : 'transparent'
  const fg = tone === 'primary' || tone === 'refer' ? color.primaryText : color.primary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      accessibilityHint={accessibilityHint}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.button, { backgroundColor: bg, borderColor: tone === 'plain' ? color.line : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{icon ? `${icon}  ` : ''}{label}</Text>}
    </Pressable>
  )
}

export function Card({ children, onPress, accent, style, accessibilityLabel }: { children: ReactNode; onPress?: () => void; accent?: string; style?: ViewStyle; accessibilityLabel?: string }) {
  const inner = [s.card, accent ? { borderLeftWidth: 5, borderLeftColor: accent } : null, style]
  if (!onPress) return <View style={inner}>{children}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [...inner, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  )
}

export function Chip({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.chipText, { color: fg }]}>{label}</Text>
    </View>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.label}>{children}</Text>
}
export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.text, muted && { color: color.muted }, style]}>{children}</Text>
}
export function Heading({ children }: { children: ReactNode }) {
  return <Text style={s.heading} accessibilityRole="header">{children}</Text>
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: space.xs }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.muted}
        style={[s.input, error ? { borderColor: color.refer } : null]}
        {...props}
      />
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  )
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.heading}>{title}</Text>
      {body ? <Body muted>{body}</Body> : null}
    </View>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={s.empty} accessibilityLabel={label}>
      <ActivityIndicator color={color.primary} size="large" />
    </View>
  )
}

export function Banner({ text, tone = 'info', action }: { text: string; tone?: 'info' | 'refer' | 'followup'; action?: ReactNode }) {
  const fg = tone === 'refer' ? color.refer : tone === 'followup' ? color.followup : color.info
  const bg = tone === 'refer' ? color.referBg : tone === 'followup' ? color.followupBg : color.infoBg
  return (
    <View style={[s.banner, { backgroundColor: bg }]} accessibilityLiveRegion="polite">
      <Text style={[s.text, { color: fg, flex: 1 }]}>{text}</Text>
      {action}
    </View>
  )
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  title: { fontSize: font.big, fontWeight: '700', color: color.text },
  subtitle: { fontSize: font.small, color: color.muted, marginTop: 2 },
  body: { padding: space.lg, gap: space.md, paddingBottom: 96 },
  button: { minHeight: touch, borderRadius: radius, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  buttonText: { fontSize: font.body, fontWeight: '700' },
  card: { backgroundColor: color.card, borderRadius: radius, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: color.line },
  chip: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '700', color: color.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  text: { fontSize: font.body, color: color.text, lineHeight: 22 },
  heading: { fontSize: font.title, fontWeight: '700', color: color.text },
  input: { minHeight: touch, borderWidth: 1, borderColor: color.line, borderRadius: radius, paddingHorizontal: space.md, fontSize: font.body, color: color.text, backgroundColor: color.card },
  error: { color: color.refer, fontSize: font.small },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius },
})
