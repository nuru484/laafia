import { View } from 'react-native'
import { dayLabel, dayStart } from '../lib/bookings'
import { space } from '../ui/theme'
import { Choice } from './Choice'

const DAY = 86_400_000

/** Today, tomorrow and the next twelve days as tappable chips. */
export function DayPicker({ value, onChange, now = Date.now() }: { value: number | null; onChange: (day: number) => void; now?: number }) {
  const today = dayStart(now)
  const days = Array.from({ length: 14 }, (_, i) => today + i * DAY)
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
      {days.map((d, i) => <Choice key={d} role="radio" label={i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayLabel(d)} on={value === d} onPress={() => onChange(d)} />)}
    </View>
  )
}
