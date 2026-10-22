import { router } from 'expo-router'
import { useState } from 'react'
import { Alert } from 'react-native'
import { Choice } from '../features/Choice'
import { DayPicker } from '../features/DayPicker'
import { ago } from '../features/format'
import { bookingRequests, confirmBooking, declineBooking, type BookingRequest } from '../lib/bookings'
import { changed, env, sendDue } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Body, Button, Card, Empty, Field, Label, Loading, Screen } from '../ui/kit'

/** Visit requests texted by clients: pick the day, and the client is texted the date and a reminder. */
export default function Bookings() {
  const { data } = useQuery(() => bookingRequests(env()))
  return (
    <Screen title="Booking requests" subtitle="Texts from clients asking for a visit." right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      {!data ? <Loading /> : data.length === 0 ? <Empty title="No requests" body="A client books by texting this phone. From an unknown number the text starts with BOOK." /> : data.map((r) => <Request key={r.id} r={r} />)}
    </Screen>
  )
}

function Request({ r }: { r: BookingRequest }) {
  const [day, setDay] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState<string | null>(r.client_id)
  const [busy, setBusy] = useState(false)
  const term = search.trim()
  const { data: matches } = useQuery(() => r.client_id || term.length < 2 ? Promise.resolve([]) : env().db.all<{ id: string; name: string; code: string }>(
    'SELECT id, name, code FROM clients WHERE deleted = 0 AND (name LIKE ? OR code LIKE ?) ORDER BY name LIMIT 6', [`%${term}%`, `%${term.toUpperCase()}%`]), [term])

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      changed()
      void sendDue()
    } catch (e) {
      Alert.alert('Could not do that', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <Body style={{ fontWeight: '700' }}>{r.client_name ? `${r.client_name} · ${r.client_code}` : 'Number not on the register'}</Body>
      <Body muted>{r.phone} · {ago(r.requested_at)}</Body>
      {r.message ? <Body>"{r.message}"</Body> : null}
      {!r.client_id ? (
        <>
          <Field label="Who is it? Search by name or code" value={search} onChangeText={setSearch} />
          {matches?.map((c) => <Choice key={c.id} role="radio" label={`${c.name} · ${c.code}`} on={clientId === c.id} onPress={() => setClientId(c.id)} />)}
          {term.length >= 2 && matches?.length === 0 ? <Body muted>No match. Enrol her first, then come back to this request.</Body> : null}
        </>
      ) : null}
      <Label>Visit day</Label>
      <DayPicker value={day} onChange={setDay} />
      <Button label={day === null ? 'Choose a day' : 'Confirm and text her'} disabled={day === null || !clientId} busy={busy}
        onPress={() => act(() => confirmBooking(env(), r.id, { day: day!, client_id: clientId ?? undefined }))} />
      <Button tone="quiet" label="Cannot book by text: ask her to call" disabled={busy} onPress={() => act(() => declineBooking(env(), r.id))} />
    </Card>
  )
}
