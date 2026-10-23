import { Ionicons } from '@expo/vector-icons'
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Pressable, TextInput as RNTextInput, StyleSheet, View, type TextInputProps, type ViewStyle } from 'react-native'
import { Text, TextInput } from './text'
import { RefreshControl, ScrollView } from 'react-native-gesture-handler'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { refreshNow } from '../lib/runtime'
import { color, font, radius, space, touch } from './theme'
import { toast } from './toast'

export type IconName = ComponentProps<typeof Ionicons>['name']

/** Pulling down anywhere syncs with the server and re-reads the phone, then says how it went. */
async function pullToRefresh() {
  const sync = await refreshNow()
  if (!sync) return
  // Refreshing is frequent: only a problem is worth a toast.
  if (sync.last_error) toast(sync.last_error === 'No internet' ? 'No internet. Everything is saved on this phone and syncs later.' : `Sync failed: ${sync.last_error}`, sync.last_error === 'No internet' ? 'info' : 'error')
}

/** Scrolls the field being typed in above the keyboard; fields call it when they gain focus. */
const RevealContext = createContext<() => void>(() => undefined)

/** `onBack` puts a back arrow before the title. The body leaves room for the tab bar and the phone's gesture bar. */
export function Screen({ title, subtitle, right, onBack, children, scroll = true }: { title: string; subtitle?: string; right?: ReactNode; onBack?: () => void; children: ReactNode; scroll?: boolean }) {
  const [refreshing, setRefreshing] = useState(false)
  const insets = useSafeAreaInsets()
  const bottom = { paddingBottom: 112 + insets.bottom }
  const scrollRef = useRef<{ scrollTo: (o: { y: number; animated?: boolean }) => void } | null>(null)
  const offset = useRef(0)

  // Android draws the app edge to edge, so the window no longer shrinks for the keyboard: the padding below makes
  // room, and this keeps the focused field just above the keyboard, on opening and on moving to another field.
  const reveal = (keyboardTop = Keyboard.metrics()?.screenY) => {
    const input = RNTextInput.State.currentlyFocusedInput()
    if (!input || keyboardTop === undefined) return
    input.measureInWindow((_x, y, _w, h) => {
      const over = y + h + space.xl - keyboardTop
      if (over > 0) scrollRef.current?.scrollTo({ y: offset.current + over, animated: true })
    })
  }
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => reveal(e.endCoordinates.screenY))
    return () => sub.remove()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onRefresh = () => {
    setRefreshing(true)
    void pullToRefresh().finally(() => setRefreshing(false))
  }
  const body = scroll ? (
    <ScrollView ref={scrollRef as never} contentContainerStyle={[s.body, bottom]} keyboardShouldPersistTaps="handled"
      onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.y }} scrollEventThrottle={32}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[color.primary]} tintColor={color.primary} />}>
      {children}
    </ScrollView>
  ) : <View style={[s.body, bottom, { flex: 1 }]}>{children}</View>
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        {/* The back box sits on the heading's first line, not centred on heading and subtitle together. */}
        <View style={s.headRow}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8}
              style={({ pressed }) => [s.back, pressed && { opacity: 0.5 }]}>
              <Ionicons name="chevron-back" size={24} color={color.text} />
            </Pressable>
          ) : null}
          <Text style={s.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
          {right ? <View style={s.headRight}>{right}</View> : null}
        </View>
        {subtitle ? <Text style={[s.subtitle, onBack ? { marginLeft: BACK - 4 + space.xs } : null]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <RevealContext.Provider value={() => setTimeout(() => reveal(), 120)}>{body}</RevealContext.Provider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

type Tone = 'primary' | 'refer' | 'plain' | 'quiet'
export function Button({ label, onPress, tone = 'primary', disabled, busy, icon, style, accessibilityHint }: { label: string; onPress: () => void; tone?: Tone; disabled?: boolean; busy?: boolean; icon?: IconName; style?: ViewStyle; accessibilityHint?: string }) {
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
      {busy ? <ActivityIndicator color={fg} /> : (
        <View style={s.buttonRow}>
          {icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
          <Text style={[s.buttonText, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  )
}

/** A header action: icon and a short word, so it reads without guessing. */
export function HeaderAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => [s.headerAction, pressed && { backgroundColor: color.primaryBg }]}>
      <Ionicons name={icon} size={20} color={color.primary} />
      <Text style={s.headerActionText}>{label}</Text>
    </Pressable>
  )
}

export function Card({ children, onPress, style, accessibilityLabel }: { children: ReactNode; onPress?: () => void; style?: ViewStyle; accessibilityLabel?: string }) {
  const inner = [s.card, style]
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

export type Option<T extends string> = { value: T; label: string; detail?: string }

/** A field's label; `required` adds the red asterisk the form's note explains. */
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={s.fieldLabel} accessibilityLabel={required ? `${label}, required` : label}>
      {label}{required ? <Text style={{ color: color.refer }}> *</Text> : null}
    </Text>
  )
}

/** Top of a form with required fields: says what the asterisk means. */
export function RequiredNote() {
  return <Text style={s.actionNote}><Text style={{ color: color.refer }}>*</Text> required. Everything else can be added later.</Text>
}

/** A labelled row of equal buttons for two to four short choices; the chosen one is filled. */
export function Segmented<T extends string>({ label, options, value, onChange, required }: { label: string; options: Option<T>[]; value: T | null; onChange: (v: T) => void; required?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} required={required} />
      <View style={s.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o, i) => {
          const on = o.value === value
          return (
            <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }}
              style={({ pressed }) => [s.segment, i > 0 && { borderLeftWidth: 0 }, on && s.segmentOn, pressed && !on && { backgroundColor: color.primaryBg }]}>
              <Text style={[s.segmentText, on && { color: color.primaryText, fontWeight: '700' }]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** A field that opens a list to choose from, for choices too long for a row of buttons. */
export function Select<T extends string>({ label, options, value, onChange, placeholder = 'Choose', required }: { label: string; options: Option<T>[]; value: T | null; onChange: (v: T) => void; placeholder?: string; required?: boolean }) {
  const [open, setOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const chosen = options.find((o) => o.value === value)
  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} required={required} />
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}`} accessibilityHint="Opens the list"
        style={({ pressed }) => [s.input, s.select, pressed && { borderColor: color.primary }]}>
        <Text style={[s.selectText, !chosen && { color: color.muted }]} numberOfLines={1}>{chosen?.label ?? placeholder}</Text>
        <Ionicons name="chevron-down" size={20} color={color.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={s.sheetScrim} onPress={() => setOpen(false)} accessibilityLabel="Close the list">
          <Pressable style={[s.sheet, { paddingBottom: insets.bottom + space.md }]} onPress={() => undefined} accessibilityViewIsModal>
            <Text style={s.sheetTitle} accessibilityRole="header">{label}</Text>
            {options.map((o) => {
              const on = o.value === value
              return (
                <Pressable key={o.value} onPress={() => { onChange(o.value); setOpen(false) }} accessibilityRole="radio" accessibilityState={{ checked: on }}
                  style={({ pressed }) => [s.sheetRow, pressed && { backgroundColor: color.primaryBg }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.sheetRowText, on && { fontWeight: '700', color: color.primary }]}>{o.label}</Text>
                    {o.detail ? <Text style={s.actionDetail}>{o.detail}</Text> : null}
                  </View>
                  {on ? <Ionicons name="checkmark" size={22} color={color.primary} /> : null}
                </Pressable>
              )
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

/** A checkbox with its sentence: the whole row is the target. */
export function CheckRow({ label, detail, on, onChange, required }: { label: string; detail?: string; on: boolean; onChange: (on: boolean) => void; required?: boolean }) {
  return (
    <Pressable onPress={() => onChange(!on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={required ? `${label}, required` : label}
      style={({ pressed }) => [s.check, pressed && { opacity: 0.7 }]}>
      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={26} color={on ? color.primary : color.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.checkText}>{label}{required ? <Text style={{ color: color.refer }}> *</Text> : null}</Text>
        {detail ? <Text style={s.actionDetail}>{detail}</Text> : null}
      </View>
    </Pressable>
  )
}

/** Steps back and forward through months, newest last; `back` is how many months before this one. */
export function MonthStepper({ back, onChange, maxBack = 24 }: { back: number; onChange: (back: number) => void; maxBack?: number }) {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
  const title = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <View style={s.stepper}>
      <Pressable onPress={() => onChange(back + 1)} disabled={back >= maxBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Earlier month" style={[s.stepBtn, back >= maxBack && { opacity: 0.3 }]}>
        <Ionicons name="chevron-back" size={22} color={color.text} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={s.stepTitle} accessibilityLiveRegion="polite">{title}</Text>
        <Text style={s.actionDetail}>{back === 0 ? 'This month, so far' : back === 1 ? 'Last month' : `${back} months ago`}</Text>
      </View>
      <Pressable onPress={() => onChange(back - 1)} disabled={back === 0} hitSlop={8} accessibilityRole="button" accessibilityLabel="Later month" style={[s.stepBtn, back === 0 && { opacity: 0.3 }]}>
        <Ionicons name="chevron-forward" size={22} color={color.text} />
      </Pressable>
    </View>
  )
}

/** Actions grouped edge to edge, like a settings list. Rows are `ActionRow`s. */
export function ActionList({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      {title ? <Text style={s.label} accessibilityRole="header">{title}</Text> : null}
      <View style={s.actionList}>{children}</View>
      {note ? <Text style={s.actionNote}>{note}</Text> : null}
    </View>
  )
}

/**
 * One action: a tinted icon, what it does, a short detail (the number it calls, what it sends), and a chevron.
 * `done` shows a tick and stops the press; `trailing` replaces the chevron (a switch, a send button).
 */
export function ActionRow({ icon, title, detail, onPress, tone = 'primary', disabled, busy, done, trailing }: {
  icon: IconName; title: string; detail?: string | null; onPress?: () => void; tone?: 'primary' | 'refer'; disabled?: boolean; busy?: boolean; done?: boolean; trailing?: ReactNode
}) {
  const fg = tone === 'refer' ? color.refer : color.primary
  const bg = tone === 'refer' ? color.referBg : color.primaryBg
  return (
    <Pressable onPress={onPress} disabled={!onPress || disabled || busy || done} accessibilityRole="button" accessibilityLabel={detail ? `${title}, ${detail}` : title}
      accessibilityState={{ disabled: !!disabled, busy: !!busy, checked: !!done }}
      style={({ pressed }) => [s.actionRow, disabled && { opacity: 0.45 }, pressed && { backgroundColor: color.primaryBg }]}>
      <View style={[s.actionIcon, { backgroundColor: done ? color.routineBg : bg }]}>
        <Ionicons name={done ? 'checkmark' : icon} size={20} color={done ? color.routine : fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[s.actionTitle, tone === 'refer' && !done ? { color: color.refer } : null]}>{title}</Text>
        {detail ? <Text style={s.actionDetail} numberOfLines={2}>{detail}</Text> : null}
      </View>
      {busy ? <ActivityIndicator color={fg} /> : trailing ?? (done || !onPress ? null : <Ionicons name="chevron-forward" size={18} color={color.muted} />)}
    </Pressable>
  )
}

/** A card's heading with an optional note on its right (a time, a count). */
export function SectionHead({ title, note }: { title: string; note?: string | null }) {
  return (
    <View style={s.sectionHead}>
      <Text style={[s.label, { flexShrink: 0 }]} accessibilityRole="header">{title}</Text>
      {note ? <Text style={s.sectionNote} numberOfLines={1}>{note}</Text> : null}
    </View>
  )
}

/** Figures at a glance: each a large number over a short label, two or three to a row. */
export function Stats({ items, columns = 2 }: { items: { value: string | number; label: string; tone?: string }[]; columns?: 2 | 3 }) {
  return (
    <View style={s.stats}>
      {items.map((i) => (
        <View key={i.label} style={[s.stat, { flexBasis: columns === 3 ? '30%' : '46%' }]} accessible accessibilityLabel={`${i.value} ${i.label}`}>
          <Text style={[s.statValue, i.tone ? { color: i.tone } : null]}>{i.value}</Text>
          <Text style={s.statLabel}>{i.label}</Text>
        </View>
      ))}
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

export function Field({ label, error, required, onFocus, ...props }: TextInputProps & { label: string; error?: string | null; required?: boolean }) {
  const reveal = useContext(RevealContext)
  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} required={required} />
      <TextInput
        accessibilityLabel={required ? `${label}, required` : label}
        placeholderTextColor={color.muted}
        style={[s.input, error ? { borderColor: color.refer } : null]}
        onFocus={(e) => { onFocus?.(e); reveal() }}
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

const TITLE_LINE = 32
const BACK = 28

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  headRight: { height: TITLE_LINE, justifyContent: 'center' },
  title: { flex: 1, minWidth: 0, fontSize: font.big - 2, lineHeight: TITLE_LINE, fontWeight: '700', color: color.text, letterSpacing: -0.3 },
  subtitle: { fontSize: font.small, color: color.muted, marginTop: 2 },
  body: { padding: space.lg, gap: space.md },
  back: { width: BACK, height: BACK, marginTop: (TITLE_LINE - BACK) / 2, marginLeft: -4, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: touch, borderRadius: radius, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonText: { fontSize: font.body, fontWeight: '700' },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 40, paddingHorizontal: space.sm },
  headerActionText: { fontSize: font.small, fontWeight: '700', color: color.primary },
  card: { backgroundColor: color.card, borderRadius: radius, padding: space.lg, gap: space.md, borderWidth: 1, borderColor: color.line },
  chip: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius },
  chipText: { fontSize: 13, fontWeight: '700' },
  label: { fontSize: font.small, fontWeight: '700', color: color.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  segments: { flexDirection: 'row' },
  segment: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm, borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  segmentOn: { backgroundColor: color.primary, borderColor: color.primary },
  segmentText: { fontSize: font.body, color: color.text, fontWeight: '600' },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  selectText: { flex: 1, fontSize: font.body, color: color.text },
  sheetScrim: { flex: 1, backgroundColor: 'rgba(14, 27, 34, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: color.card, paddingTop: space.lg, borderTopWidth: 1, borderColor: color.line },
  sheetTitle: { fontSize: font.title, fontWeight: '700', color: color.text, paddingHorizontal: space.lg, paddingBottom: space.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: space.lg, borderTopWidth: 1, borderColor: color.line },
  sheetRowText: { fontSize: font.body + 1, color: color.text },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: 6 },
  checkText: { fontSize: font.body, lineHeight: 22, color: color.text, marginTop: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingHorizontal: space.sm, borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: font.body + 1, fontWeight: '700', color: color.text },
  actionList: { marginHorizontal: -space.lg, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: 10, paddingHorizontal: space.lg, borderBottomWidth: 1, borderColor: color.line },
  actionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: font.body, fontWeight: '600', color: color.text },
  actionDetail: { fontSize: 13, lineHeight: 18, color: color.muted },
  actionNote: { fontSize: 13, lineHeight: 18, color: color.muted },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  sectionNote: { flexShrink: 1, fontSize: font.small, color: color.muted, textAlign: 'right' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: { flexGrow: 1, paddingVertical: space.md, paddingHorizontal: space.md, backgroundColor: color.bg, gap: 2 },
  statValue: { fontSize: 26, fontWeight: '700', color: color.text, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  statLabel: { fontSize: 13, color: color.muted, lineHeight: 17 },
  text: { fontSize: font.body, color: color.text, lineHeight: 22 },
  heading: { fontSize: font.title, fontWeight: '700', color: color.text },
  fieldLabel: { fontSize: font.small, fontWeight: '600', color: color.text },
  input: { minHeight: 52, borderWidth: 1, borderColor: color.line, borderRadius: radius, paddingHorizontal: 14, fontSize: font.body, color: color.text, backgroundColor: color.card },
  error: { color: color.refer, fontSize: font.small },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius },
})
