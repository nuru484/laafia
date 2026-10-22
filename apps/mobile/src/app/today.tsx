import { router } from 'expo-router'
import { View } from 'react-native'
import { TabBar } from '../features/TabBar'
import { TYPE_NAME } from '../features/format'
import { useState } from 'react'
import { setManualOrder, todayList } from '../lib/register'
import { changed, currentSession, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Empty, Loading, Screen } from '../ui/kit'
import { color, space } from '../ui/theme'

export default function Today() {
  const s = currentSession()
  const origin = { lat: s?.facility.lat ?? 0, lng: s?.facility.lng ?? 0 }
  const { data, error } = useQuery(() => todayList(env(), origin, 12))
  const [reorder, setReorder] = useState(false)

  async function move(index: number, delta: number) {
    if (!data) return
    const ids = data.map((r) => r.client_id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j]!, ids[index]!]
    await setManualOrder(env(), ids)
    changed()
  }
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Today's visits" subtitle={`${date}. Most urgent first, then a walking route.`}
        right={<View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button tone="plain" label={reorder ? 'Done' : 'Reorder'} onPress={() => setReorder((v) => !v)} />
          <Button tone="plain" label="Enrol" onPress={() => router.push('/enrol')} />
        </View>}>
        {error ? <Banner tone="refer" text={error.message} /> : null}
        {!data ? <Loading /> : data.length === 0 ? <Empty title="No one on the register yet" body="Enrol households as you visit, or sync to download the register." /> : null}
        {data?.map((r, i) => (
          <Card key={r.client_id} onPress={() => router.push(`/client/${r.client_id}`)} accent={r.pinned === 'scheduled' ? color.followup : r.pinned ? color.refer : r.score >= 0.6 ? color.followup : color.line}
            accessibilityLabel={`${i + 1}. ${r.name}, ${TYPE_NAME[r.type]}. ${r.reasons.map((x) => x.text).join(', ')}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
              <Body style={{ fontWeight: '700', flex: 1 }}>{i + 1}. {r.name}</Body>
              <Chip label={TYPE_NAME[r.type] ?? r.type} fg={color.info} bg={color.infoBg} />
            </View>
            {r.pinned === 'open_referral' ? <Chip label="Open referral" fg={color.refer} bg={color.referBg} /> : null}
            {r.pinned === 'newborn_48h' ? <Chip label="Newborn: visit within 48 hours" fg={color.refer} bg={color.referBg} /> : null}
            {r.pinned === 'scheduled' ? <Chip label="Scheduled today" fg={color.followup} bg={color.followupBg} /> : null}
            {r.reasons.length ? <Body>Why: {r.reasons.map((x) => x.text).join('; ')}</Body> : <Body muted>Routine check</Body>}
            <Body muted>{r.landmark || r.community}{r.lat === null ? ' (no GPS yet)' : ''}</Body>
            {reorder ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button style={{ flex: 1 }} tone="plain" label="Move up" disabled={i === 0} onPress={() => move(i, -1)} />
                <Button style={{ flex: 1 }} tone="plain" label="Move down" disabled={i === data.length - 1} onPress={() => move(i, 1)} />
              </View>
            ) : null}
          </Card>
        ))}
      </Screen>
      <TabBar />
    </View>
  )
}
