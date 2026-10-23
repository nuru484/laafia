import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import type { ReferralListRow } from '../lib/register'
import type { IconName } from '../ui/kit'
import { color, font, space } from '../ui/theme'
import { STATUS_TEXT, ago, statusTone } from './format'

const URGENCY: Record<number, { label: string; icon: IconName; fg: string }> = {
  3: { label: 'Emergency', icon: 'alert-circle', fg: color.refer },
  2: { label: 'Urgent', icon: 'warning', fg: color.followup },
  1: { label: 'Routine', icon: 'ellipse-outline', fg: color.muted },
}

/**
 * One referral, laid out like a Today row: urgency in the first column; then who and when, the danger signs,
 * and where it stands. Sits in a `ReferralList`.
 */
export function ReferralRow({ r, showOrigin, hideClient }: { r: ReferralListRow; showOrigin?: boolean; hideClient?: boolean }) {
  const tone = statusTone(r.status)
  const urgency = URGENCY[r.urgency] ?? URGENCY[1]!
  const alert = r.alert === 'no_ack' ? 'No acknowledgement' : r.alert === 'not_arrived' ? 'Did not arrive' : null
  const where = showOrigin ? `from ${r.origin_name ?? r.origin_device_id}` : `to ${r.destination_name}`
  return (
    <Pressable onPress={() => router.push(`/referral/${r.id}`)} accessibilityRole="button"
      accessibilityLabel={`${urgency.label} referral${hideClient ? '' : `, ${r.type_label} ${r.client_name ?? r.client_code}`}, ${STATUS_TEXT[r.status]}${alert ? `, ${alert}` : ''}, ${where}`}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: color.primaryBg }]}>
      <Ionicons name={urgency.icon} size={20} color={urgency.fg} style={st.icon} />
      <View style={st.body}>
        <View style={st.top}>
          <Text style={st.name} numberOfLines={1}>{hideClient ? `Referral ${r.short_id}` : r.client_name ?? r.client_code}</Text>
          <Text style={st.time}>{ago(r.created_at)}</Text>
        </View>
        <Text style={st.signs} numberOfLines={1}>{hideClient ? '' : `${r.type_label} · `}{r.signs.join(', ')}</Text>
        <View style={st.status}>
          <View style={[st.dot, { backgroundColor: alert ? color.refer : tone.fg }]} />
          <Text style={[st.statusText, { color: alert ? color.refer : tone.fg }]} numberOfLines={1}>{alert ?? STATUS_TEXT[r.status]}</Text>
          <Text style={st.where} numberOfLines={1}>· {where}</Text>
        </View>
      </View>
    </Pressable>
  )
}

/** Edge to edge, rows split by hairlines: no card around each one. */
export function ReferralList({ rows, showOrigin, hideClient }: { rows: ReferralListRow[]; showOrigin?: boolean; hideClient?: boolean }) {
  return (
    <View style={st.list}>
      {rows.map((r) => <ReferralRow key={r.id} r={r} showOrigin={showOrigin} hideClient={hideClient} />)}
    </View>
  )
}

const st = StyleSheet.create({
  list: { marginHorizontal: -space.lg, borderTopWidth: 1, borderColor: color.line },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 13, backgroundColor: color.card, borderBottomWidth: 1, borderColor: color.line },
  icon: { width: 22, marginTop: 1 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  name: { flex: 1, fontSize: font.body + 1, lineHeight: 22, fontWeight: '600', color: color.text },
  time: { fontSize: 13, color: color.muted, fontVariant: ['tabular-nums'] },
  signs: { fontSize: font.small, color: color.muted },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flexShrink: 0, fontSize: font.small, fontWeight: '600' },
  where: { flex: 1, minWidth: 0, fontSize: font.small, color: color.muted },
})
