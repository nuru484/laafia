import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text, rowScale } from '../ui/text'
import { SortableList } from '../features/SortableList'
import { TabBar } from '../features/TabBar'
import { TYPE_NAME } from '../features/format'
import { bookingRequests } from '../lib/bookings'
import { setManualOrder, todayList, type TodayRow } from '../lib/register'
import { changed, currentSession, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Empty, HeaderAction, Loading, Screen } from '../ui/kit'
import { color, font, space } from '../ui/theme'
import { toast } from '../ui/toast'

// The row's height at normal text size; it grows with the phone's text setting (see rowScale).
const ROW = 84
/** A day's walk: pinned clients always come, routine ones fill up to this many. */
const DAY_CAP = 12

const PIN: Record<NonNullable<TodayRow['pinned']>, { text: string; fg: string }> = {
  open_referral: { text: 'Open referral', fg: color.refer },
  newborn_48h: { text: 'Newborn, visit within 48 h', fg: color.refer },
  scheduled: { text: 'Scheduled today', fg: color.followup },
}

export default function Today() {
  const s = currentSession()
  const origin = { lat: s?.facility.lat ?? 0, lng: s?.facility.lng ?? 0 }
  const [extra, setExtra] = useState(0)
  const { fontScale } = useWindowDimensions()
  const rowHeight = Math.round(ROW * rowScale(fontScale))
  const { data, error } = useQuery(() => todayList(env(), origin, DAY_CAP + extra), [extra])
  const waiting = data?.filter((r) => !r.done) ?? []
  const done = data?.filter((r) => r.done) ?? []
  const { data: requests } = useQuery(() => bookingRequests(env()))
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  async function reorder(ids: string[]) {
    try {
      await setManualOrder(env(), ids)
      changed()
    } catch (e) {
      toast(`Could not keep the new order: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Today" subtitle={data ? `${date} · ${done.length} of ${data.length} visited` : date}
        right={<HeaderAction icon="person-add-outline" label="Enrol" onPress={() => router.push('/enrol')} />}>
        {error ? <Banner tone="refer" text={error.message} /> : null}
        {requests?.length ? (
          <Pressable onPress={() => router.push('/bookings')} accessibilityRole="button" accessibilityLabel={`${requests.length} booking requests by text. Open to choose the days.`}
            style={({ pressed }) => [st.notice, pressed && { opacity: 0.8 }]}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={color.primary} />
            <Text style={st.noticeText}>{requests.length} booking {requests.length === 1 ? 'request' : 'requests'} by text</Text>
            <Ionicons name="chevron-forward" size={18} color={color.primary} />
          </Pressable>
        ) : null}
        {!data ? <Loading /> : data.length === 0 ? <Empty title="No one on the register yet" body="Enrol households as you visit, or pull down to download the register." /> : (
          <>
            {waiting.length ? <Text style={st.hint}>Most urgent first, then a walking route. Hold a row to move it.</Text> : <Text style={st.hint}>Everyone on today's list has been visited.</Text>}
            {waiting.length ? <View style={{ marginHorizontal: -space.lg }}>
              <SortableList items={waiting} keyOf={(r) => r.client_id} rowHeight={rowHeight} onReorder={reorder}
                onPress={(r) => router.push(`/client/${r.client_id}`)}
                label={(r, i) => `${i + 1}. ${r.name}, ${TYPE_NAME[r.type]}. ${r.pinned ? PIN[r.pinned].text + '. ' : ''}${r.reasons.map((x) => x.text).join(', ')}`}
                renderRow={(r, i) => <VisitRow r={r} n={i + 1} />} />
            </View> : null}
            <Pressable onPress={() => setExtra((x) => x + 5)} accessibilityRole="button" accessibilityHint="Adds the next five clients by risk to today's list"
              style={({ pressed }) => [st.more, pressed && { backgroundColor: color.primaryBg }]}>
              <Ionicons name="add" size={20} color={color.primary} />
              <Text style={st.moreText}>Add more visits for today</Text>
            </Pressable>
            {done.length ? (
              <>
                <Text style={st.section}>Visited today</Text>
                <View style={st.doneList}>
                  {done.map((r) => <DoneRow key={r.client_id} r={r} />)}
                </View>
              </>
            ) : null}
          </>
        )}
      </Screen>
      <TabBar />
    </View>
  )
}

function VisitRow({ r, n }: { r: TodayRow; n: number }) {
  const pin = r.pinned ? PIN[r.pinned] : null
  const why = r.reasons.map((x) => x.text).join(' · ')
  return (
    <View style={st.row}>
      <Text style={st.rank}>{n}</Text>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={st.name} numberOfLines={1}>{r.name}</Text>
        <Text style={st.meta} numberOfLines={1}>{TYPE_NAME[r.type] ?? r.type} · {r.landmark || r.community}{r.lat === null ? ' · no GPS yet' : ''}</Text>
        <Text style={st.why} numberOfLines={1}>
          {pin ? <Text style={{ color: pin.fg, fontWeight: '700' }}>{pin.text}{why ? ' · ' : ''}</Text> : null}
          {why || (pin ? '' : 'Routine check')}
        </Text>
      </View>
      <Ionicons name="reorder-three" size={22} color={color.muted} style={{ marginTop: 1 }} />
    </View>
  )
}

const OUTCOME = {
  routine: { text: 'Routine', icon: 'checkmark-circle', fg: color.routine },
  followup: { text: 'Follow-up', icon: 'time', fg: color.followup },
  refer: { text: 'Referred', icon: 'paper-plane', fg: color.refer },
} as const

/** Done today: stays in view so the nurse sees the day's progress, with how the visit ended. Tap to see her. */
function DoneRow({ r }: { r: TodayRow }) {
  const o = OUTCOME[r.done!.outcome] ?? OUTCOME.routine
  const due = r.done!.followup_due ? ` in ${Math.max(1, Math.round((r.done!.followup_due - r.done!.at) / 86_400_000))} d` : ''
  const at = new Date(r.done!.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <Pressable onPress={() => router.push(`/client/${r.client_id}`)} accessibilityRole="button" accessibilityLabel={`${r.name}, visited at ${at}, ${o.text}${due}`}
      style={({ pressed }) => [st.done, pressed && { backgroundColor: color.primaryBg }]}>
      <Ionicons name={o.icon} size={22} color={o.fg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.doneName} numberOfLines={1}>{r.name}</Text>
        <Text style={st.meta} numberOfLines={1}>{TYPE_NAME[r.type] ?? r.type} · visited {at}</Text>
      </View>
      <Text style={[st.doneOutcome, { color: o.fg }]}>{o.text}{due}</Text>
    </Pressable>
  )
}

const st = StyleSheet.create({
  section: { fontSize: font.small, fontWeight: '700', color: color.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space.md },
  doneList: { marginHorizontal: -space.lg, borderTopWidth: 1, borderColor: color.line },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.lg, backgroundColor: color.card, borderBottomWidth: 1, borderColor: color.line },
  doneName: { fontSize: font.body, fontWeight: '600', color: color.muted },
  doneOutcome: { fontSize: font.small, fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, backgroundColor: color.primaryBg },
  noticeText: { flex: 1, fontSize: font.body, fontWeight: '600', color: color.text },
  hint: { fontSize: font.small, color: color.muted },
  // The number sits on the name's line; the details below start under the name.
  row: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingTop: 13 },
  rank: { width: 22, fontSize: font.body + 1, lineHeight: 22, fontWeight: '700', color: color.primary, fontVariant: ['tabular-nums'] },
  name: { fontSize: font.body + 1, lineHeight: 22, fontWeight: '600', color: color.text },
  more: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 48, marginHorizontal: -space.lg, borderBottomWidth: 1, borderColor: color.line, backgroundColor: color.card },
  moreText: { fontSize: font.body, fontWeight: '600', color: color.primary },
  meta: { fontSize: font.small, color: color.muted },
  why: { fontSize: font.small, color: color.text },
})
