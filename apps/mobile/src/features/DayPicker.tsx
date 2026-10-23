import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { dayStart } from '../lib/bookings'
import { color, font, radius, space } from '../ui/theme'

const DAY = 86_400_000
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** How far ahead a visit can be booked. */
const MONTHS_AHEAD = 12

/**
 * A month calendar. By default any day from today on (booking a visit); with `pastDays`, only the last that many
 * days up to today (a birth date). Days are UTC midnights, the same as the bookings table (Ghana keeps UTC all
 * year). Weeks start on Monday.
 */
export function DayPicker({ value, onChange, now = Date.now(), pastDays }: { value: number | null; onChange: (day: number) => void; now?: number; pastDays?: number }) {
  const today = dayStart(now)
  const t = new Date(today)
  const [offset, setOffset] = useState(0)
  const earliest = pastDays !== undefined ? today - pastDays * DAY : today
  const e = new Date(earliest)
  const minOffset = pastDays !== undefined ? (e.getUTCFullYear() - t.getUTCFullYear()) * 12 + e.getUTCMonth() - t.getUTCMonth() : 0
  const maxOffset = pastDays !== undefined ? 0 : MONTHS_AHEAD
  const first = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1)
  const f = new Date(first)
  const daysIn = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate()
  const lead = (f.getUTCDay() + 6) % 7
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => first + i * DAY)]
  while (cells.length % 7) cells.push(null)
  const title = f.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <View style={st.wrap}>
      <View style={st.head}>
        <Pressable onPress={() => setOffset((o) => o - 1)} disabled={offset <= minOffset} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous month"
          style={[st.nav, offset <= minOffset && { opacity: 0.3 }]}>
          <Ionicons name="chevron-back" size={22} color={color.text} />
        </Pressable>
        <Text style={st.month} accessibilityRole="header" accessibilityLiveRegion="polite">{title}</Text>
        <Pressable onPress={() => setOffset((o) => o + 1)} disabled={offset >= maxOffset} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next month"
          style={[st.nav, offset >= maxOffset && { opacity: 0.3 }]}>
          <Ionicons name="chevron-forward" size={22} color={color.text} />
        </Pressable>
      </View>
      <View style={st.grid}>
        {WEEK.map((w) => <Text key={w} style={st.weekday}>{w.slice(0, 1)}</Text>)}
        {cells.map((d, i) => {
          if (d === null) return <View key={`x${i}`} style={st.cell} />
          const out = d < earliest || (pastDays !== undefined && d > today)
          const on = value === d
          const isToday = d === today
          return (
            <Pressable key={d} onPress={() => onChange(d)} disabled={out} accessibilityRole="button"
              accessibilityLabel={new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) + (isToday ? ', today' : '')}
              accessibilityState={{ selected: on, disabled: out }}
              style={({ pressed }) => [st.cell, isToday && st.today, on && st.on, pressed && !on && { backgroundColor: color.primaryBg }]}>
              <Text style={[st.day, out && { color: color.line }, isToday && { fontWeight: '800' }, on && { color: color.primaryText, fontWeight: '700' }]}>{new Date(d).getUTCDate()}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: font.body + 1, fontWeight: '700', color: color.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '700', color: color.muted, paddingBottom: space.xs },
  cell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius },
  today: { borderWidth: 1, borderColor: color.primary },
  on: { backgroundColor: color.primary, borderColor: color.primary },
  day: { fontSize: font.body, color: color.text, fontVariant: ['tabular-nums'] },
})
