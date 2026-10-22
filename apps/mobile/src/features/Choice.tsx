import { Pressable, Text } from 'react-native'
import { color, radius, space, touch } from '../ui/theme'

/** A large tappable option; `on` marks the chosen one. */
export function Choice({ label, on, onPress, role = 'checkbox' }: { label: string; on: boolean; onPress: () => void; role?: 'checkbox' | 'radio' }) {
  return (
    <Pressable onPress={onPress} accessibilityRole={role} accessibilityState={{ checked: on }}
      style={{ minHeight: touch, paddingHorizontal: space.md, borderRadius: radius, borderWidth: 2, borderColor: on ? color.primary : color.line, backgroundColor: on ? '#E6F4F1' : color.card, justifyContent: 'center' }}>
      <Text style={{ fontSize: 16, color: color.text, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </Pressable>
  )
}
