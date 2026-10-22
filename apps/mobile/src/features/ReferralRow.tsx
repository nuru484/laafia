import { router } from 'expo-router'
import { View } from 'react-native'
import type { ReferralListRow } from '../lib/register'
import { Body, Card, Chip } from '../ui/kit'
import { color, space } from '../ui/theme'
import { STATUS_TEXT, ago, statusTone } from './format'

export function ReferralRow({ r, showOrigin }: { r: ReferralListRow; showOrigin?: boolean }) {
  const tone = statusTone(r.status)
  return (
    <Card onPress={() => router.push(`/referral/${r.id}`)} accent={r.urgency === 3 ? color.refer : r.urgency === 2 ? color.followup : color.line}
      accessibilityLabel={`Urgency ${r.urgency} referral, ${r.type_label} ${r.client_name ?? r.client_code}, ${STATUS_TEXT[r.status]}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Body style={{ fontWeight: '700', flex: 1 }}>{r.type_label} {r.client_name ?? r.client_code}</Body>
        <Chip label={`Urgency ${r.urgency}`} fg={r.urgency === 3 ? color.refer : color.followup} bg={r.urgency === 3 ? color.referBg : color.followupBg} />
      </View>
      <Body>{r.signs.join(', ')}</Body>
      <Chip label={STATUS_TEXT[r.status]} fg={tone.fg} bg={tone.bg} />
      {r.alert === 'no_ack' ? <Chip label="No acknowledgement" fg={color.refer} bg={color.referBg} /> : null}
      {r.alert === 'not_arrived' ? <Chip label="Did not arrive" fg={color.refer} bg={color.referBg} /> : null}
      <Body muted>{showOrigin ? `From ${r.origin_name ?? r.origin_device_id}` : `To ${r.destination_name}`} · {ago(r.created_at)}</Body>
    </Card>
  )
}
