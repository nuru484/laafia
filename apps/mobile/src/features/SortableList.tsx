import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler'
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { color } from '../ui/theme'

type Slots = Record<string, number>

/**
 * A list you reorder by holding a row and dragging it; a quick tap opens it. Rows are one fixed height, which
 * keeps the slot maths exact. Screen readers get Move up and Move down actions instead of the drag.
 */
export function SortableList<T>({ items, keyOf, rowHeight, renderRow, label, onPress, onReorder }: {
  items: T[]
  keyOf: (item: T) => string
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
  label: (item: T, index: number) => string
  onPress: (item: T) => void
  onReorder: (keys: string[]) => void
}) {
  const keys = items.map(keyOf)
  const slots = useSharedValue<Slots>(Object.fromEntries(keys.map((k, i) => [k, i])))
  const joined = keys.join('|')
  // A fresh list from the database (after a drop, a sync or a new visit) becomes the new resting order.
  useEffect(() => { slots.set(Object.fromEntries(keys.map((k, i) => [k, i]))) }, [joined]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (s: Slots) => {
    const next = Object.keys(s).sort((a, b) => s[a]! - s[b]!)
    if (next.join('|') !== joined) onReorder(next)
  }
  const move = (index: number, delta: number) => {
    const j = index + delta
    if (j < 0 || j >= keys.length) return
    const next = [...keys]
    ;[next[index], next[j]] = [next[j]!, next[index]!]
    onReorder(next)
  }

  return (
    <View style={{ height: items.length * rowHeight, borderTopWidth: 1, borderColor: color.line }}>
      {items.map((item, i) => (
        <Row key={keys[i]} id={keys[i]!} index={i} count={items.length} rowHeight={rowHeight} slots={slots} label={label(item, i)}
          onPress={() => onPress(item)} onCommit={commit} onMove={(d) => move(i, d)}>
          {renderRow(item, i)}
        </Row>
      ))}
    </View>
  )
}

function Row({ id, index, count, rowHeight, slots, label, onPress, onCommit, onMove, children }: {
  id: string; index: number; count: number; rowHeight: number; slots: SharedValue<Slots>; label: string
  onPress: () => void; onCommit: (s: Slots) => void; onMove: (delta: number) => void; children: ReactNode
}) {
  const y = useSharedValue(index * rowHeight)
  const start = useSharedValue(0)
  const dragging = useSharedValue(false)
  const pressed = useSharedValue(false)

  // Rows the dragged one passes slide into their new slots.
  useAnimatedReaction(() => slots.get()[id], (slot) => {
    if (slot === undefined || dragging.get()) return
    y.set(withTiming(slot * rowHeight, { duration: 160 }))
  })

  const pan = usePanGesture({
    activateAfterLongPress: 280,
    onActivate: () => {
      dragging.set(true)
      start.set(y.get())
    },
    onUpdate: (e) => {
      const at = Math.min(Math.max(start.get() + e.translationY, 0), (count - 1) * rowHeight)
      y.set(at)
      const s = slots.get()
      const from = s[id]!
      const to = Math.round(at / rowHeight)
      if (to === from) return
      const next: Slots = {}
      for (const k in s) {
        const v = s[k]!
        next[k] = k === id ? to : from < to && v > from && v <= to ? v - 1 : from > to && v >= to && v < from ? v + 1 : v
      }
      slots.set(next)
    },
    onDeactivate: () => {
      dragging.set(false)
      y.set(withTiming(slots.get()[id]! * rowHeight, { duration: 160 }))
      scheduleOnRN(onCommit, slots.get())
    },
  })
  const tap = useTapGesture({
    onBegin: () => pressed.set(true),
    onActivate: () => scheduleOnRN(onPress),
    onFinalize: () => pressed.set(false),
  })
  const gesture = useCompetingGestures(pan, tap)

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.get() }],
    zIndex: dragging.get() ? 10 : 0,
    backgroundColor: dragging.get() || pressed.get() ? color.primaryBg : color.card,
    borderColor: dragging.get() ? color.primary : color.line,
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[{ position: 'absolute', left: 0, right: 0, height: rowHeight, borderBottomWidth: 1 }, style]}
        accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the client. Hold and drag to change the order."
        accessibilityActions={[{ name: 'activate' }, { name: 'moveUp', label: 'Move up' }, { name: 'moveDown', label: 'Move down' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') onPress()
          if (e.nativeEvent.actionName === 'moveUp') onMove(-1)
          if (e.nativeEvent.actionName === 'moveDown') onMove(1)
        }}>
        {children}
      </Animated.View>
    </GestureDetector>
  )
}
