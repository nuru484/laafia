import { protocolIdFor } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Linking, StyleSheet, View } from 'react-native'
import { Text } from '../../ui/text'
import { ReferralList } from '../../features/ReferralRow'
import { TYPE_NAME, ageText, ago, outcomeTone } from '../../features/format'
import { DayPicker } from '../../features/DayPicker'
import { dayLabel, nextBooking, scheduleVisit } from '../../lib/bookings'
import { captureHouse } from '../../lib/gps'
import { clientReferrals, dayKey, toClient } from '../../lib/register'
import { changed, env, sendDue } from '../../lib/runtime'
import { useQuery } from '../../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Heading, Label, Loading, Screen } from '../../ui/kit'
import { space } from '../../ui/theme'
import { confirm } from '../../ui/confirm'
import { toast } from '../../ui/toast'

export default function ClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [gps, setGps] = useState<string | null>(null)
  const [day, setDay] = useState<number | null>(null)
  const [booking, setBooking] = useState(false)
  const { data } = useQuery(async () => {
    const { db } = env()
    const c = await db.get<any>('SELECT * FROM clients WHERE id = ?', [id])
    if (!c) return null
    const h = await db.get<{ id: string; head_name: string; community: string; landmark: string; lat: number | null; lng: number | null }>('SELECT * FROM households WHERE id = ?', [c.household_id])
    const visits = await db.all<{ id: string; visited_at: number; outcome: string; rule_id: string; protocol_id: string }>('SELECT id, visited_at, outcome, rule_id, protocol_id FROM visits WHERE client_id = ? AND deleted = 0 ORDER BY visited_at DESC LIMIT 10', [id])
    const refs = await db.all<{ id: string; short_id: string; visit_id: string | null }>('SELECT id, short_id, visit_id FROM referrals WHERE client_id = ?', [id])
    const due = await db.get<{ followup_due: number }>('SELECT followup_due FROM visits WHERE client_id = ? AND deleted = 0 AND followup_due IS NOT NULL ORDER BY visited_at DESC LIMIT 1', [id])
    return { client: toClient(c), next_of_kin: c.next_of_kin as string | null, household: h, visits, refs, referrals: await clientReferrals(env(), id), due: due?.followup_due ?? null, booked: await nextBooking(env(), id) }
  }, [id])

  if (data === undefined) return <Loading />
  if (data === null) return <Screen title="Client not found" onBack={() => router.back()}><Body muted>It may have been removed on another phone.</Body></Screen>
  const { client, household, visits, refs } = data
  const birth = client.type === 'postpartum' ? client.delivery_date : client.dob
  const ageDays = birth !== null ? Math.floor((Date.now() - birth) / 86_400_000) : null
  const protocol = protocolIdFor(client.type, client.type === 'child' || client.type === 'newborn' ? ageDays : null)

  // A visit recorded today replaces the start button: the nurse sees it was done, and a second checklist is a choice.
  const seenToday = visits.find((v) => v.rule_id !== 'REFERRAL-CLOSED' && dayKey(v.visited_at) === dayKey(Date.now())) ?? null
  const seenTone = outcomeTone(seenToday?.outcome ?? 'routine')
  const seenRef = seenToday ? refs.find((r) => r.visit_id === seenToday.id) ?? null : null
  async function startAgain() {
    const ok = await confirm({
      title: 'Start another checklist today?',
      body: `She was seen at ${new Date(seenToday!.visited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${seenTone.label.toLowerCase()}). A new checklist is a second visit record: use it when her condition has changed since.`,
      confirm: 'Start a new checklist',
    })
    if (ok) router.push(`/visit/${client.id}?protocol=${protocol}`)
  }

  async function fixGps() {
    setGps('Finding the house position. Stand outside at the door; with no data the first reading can take a minute.')
    const fix = await captureHouse(90_000, (n, best) => setGps(`Reading ${n}, best accuracy ${Math.round(best)} m`))
    if (!fix || !household) { setGps('No position yet. Check that location is on, step into the open, and try again.'); return }
    await env().db.run('UPDATE households SET lat = ?, lng = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?', [fix.lat, fix.lng, Date.now(), env().self.device_id, household.id])
    setGps(`Saved, accurate to about ${fix.accuracy} m.`)
    toast('House position saved')
    changed()
  }

  async function book() {
    if (day === null) return
    const ok = await confirm({ title: `Book a visit for ${dayLabel(day)}?`, body: client.phone ? 'She is texted the date now and a reminder the day before.' : 'She has no phone number, so she is not texted. Tell her the day yourself.', confirm: client.phone ? 'Book and text her' : 'Book the visit' })
    if (!ok) return
    setBooking(true)
    try {
      await scheduleVisit(env(), client.id, day)
      toast(`Visit booked for ${dayLabel(day)}${client.phone ? '. She is texted the date.' : ''}`)
      setDay(null)
      changed()
      void sendDue()
    } catch (e) {
      toast(`Could not book: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBooking(false)
    }
  }

  // A geo: link opens whichever map app the phone has; offline maps there work without signal.
  async function directions() {
    if (!household || household.lat === null || household.lng === null) return
    const at = `${household.lat},${household.lng}`
    try {
      await Linking.openURL(`geo:${at}?q=${at}(${encodeURIComponent(client.name)})`)
    } catch {
      setGps('No map app on this phone. Install Google Maps or OsmAnd to get directions.')
    }
  }

  return (
    <Screen title={client.name} subtitle={`${TYPE_NAME[client.type]} · ${client.code}`} onBack={() => router.back()}>
      {seenToday ? (
        <View style={[st.seen, { backgroundColor: seenTone.bg }]}>
          <View style={st.seenHead}>
            <Ionicons name="checkmark-circle" size={22} color={seenTone.fg} />
            <Text style={[st.seenTitle, { color: seenTone.fg }]}>Seen today at {new Date(seenToday.visited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {seenTone.label}</Text>
          </View>
          <Button label={seenRef ? 'Open the referral' : "View today's checklist"} onPress={() => router.push(seenRef ? `/referral/${seenRef.id}` : `/visit/${client.id}?protocol=${seenToday.protocol_id}&visit=${seenToday.id}`)} />
          <Button tone="plain" label="Start a new checklist" icon="add" onPress={() => void startAgain()} />
        </View>
      ) : (
        <Button label="Start visit checklist" icon="clipboard-outline" onPress={() => router.push(`/visit/${client.id}?protocol=${protocol}`)} />
      )}
      {client.type === 'pregnant' ? (
        <>
          {client.edd && client.edd < Date.now() ? <Banner tone="followup" text={`Her due date, ${new Date(client.edd).toLocaleDateString()}, has passed. Has she given birth? Record the delivery.`} /> : null}
          <Button tone="plain" icon="heart-outline" label="Record the delivery" onPress={() => router.push(`/delivery/${client.id}`)} />
        </>
      ) : null}
      <Button tone="plain" label="Edit client details" onPress={() => router.push(`/client/edit/${client.id}`)} />
      <Card>
        <Label>Details</Label>
        {client.type === 'pregnant' && client.edd ? <Body>Due {new Date(client.edd).toLocaleDateString()} · pregnancy {client.parity === 0 ? 'first' : `number ${(client.parity ?? 0) + 1}`}</Body> : null}
        {client.type === 'postpartum' && client.delivery_date ? <Body>Delivered {ago(client.delivery_date)}</Body> : null}
        {client.dob ? <Body>{ageText(client.dob)}{client.birth_weight_g ? ` · born ${client.birth_weight_g} g` : ''}</Body> : null}
        {client.prior_complications.length ? <Body>Previous: {client.prior_complications.join(', ').replace(/_/g, ' ')}</Body> : null}
        <Body>NHIS {client.nhis_active ? 'active' : 'not active'}{data.next_of_kin ? ` · next of kin ${data.next_of_kin}` : ''}</Body>
        <Body>{client.phone ? `Phone ${client.phone}` : 'No phone yet: she gets no visit texts'}</Body>
      </Card>
      <Card>
        <Label>{data.booked ? `Visit booked for ${dayLabel(data.booked)}` : 'Book a visit'}</Label>
        <Body muted>{data.booked ? 'Choose another day to move it.' : 'She is on the Today list from that day until the visit is recorded.'}{client.phone ? ' She is texted the date and a reminder the day before.' : ''}</Body>
        <DayPicker value={day} onChange={setDay} />
        <Button label={day === null ? 'Choose a day' : `${data.booked ? 'Move the visit to' : 'Book'} ${dayLabel(day)}`} disabled={day === null} busy={booking} onPress={book} />
      </Card>
      {household ? (
        <Card>
          <Label>House</Label>
          <Body>{household.head_name}, {household.community}</Body>
          <Body muted>{household.landmark}</Body>
          <Body muted>{household.lat !== null ? `GPS ${household.lat.toFixed(5)}, ${household.lng!.toFixed(5)}` : 'No GPS position yet'}</Body>
          {household.lat !== null ? <Button label="Directions" onPress={directions} /> : null}
          <Button tone="plain" label={household.lat !== null ? 'Update house position' : 'Capture house position'} onPress={fixGps} />
          {gps ? <Banner text={gps} /> : null}
        </Card>
      ) : null}
      {data.due && data.due > Date.now() - 86_400_000 ? (
        <Card>
          <Label>Follow-up {new Date(data.due).toLocaleDateString()}</Label>
          <Body muted>It appears on the Today list from that day until the visit is recorded.</Body>
        </Card>
      ) : null}
      {data.referrals.length ? (
        <View style={{ gap: space.sm }}>
          <Heading>Referrals</Heading>
          <ReferralList rows={data.referrals} hideClient />
        </View>
      ) : null}
      <Heading>Visits</Heading>
      {visits.length === 0 ? <Body muted>No visits recorded yet.</Body> : visits.map((v) => {
        const t = outcomeTone(v.outcome)
        const ref = refs.find((r) => r.visit_id === v.id)
        return (
          <Card key={v.id} onPress={() => router.push(ref ? `/referral/${ref.id}` : `/visit/${client.id}?protocol=${v.protocol_id}&visit=${v.id}`)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body>{new Date(v.visited_at).toLocaleDateString()}</Body>
              <Chip label={t.label} fg={t.fg} bg={t.bg} />
            </View>
            <Body muted>Rule {v.rule_id}{ref ? ` · referral ${ref.short_id}` : v.outcome === 'refer' ? ' · referral not sent: open to send it' : ''}</Body>
          </Card>
        )
      })}
    </Screen>
  )
}

const st = StyleSheet.create({
  seen: { padding: space.lg, gap: space.md },
  seenHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  seenTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
})
