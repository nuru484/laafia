import { protocolIdFor } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { TYPE_NAME, ageText, ago, outcomeTone } from '../../features/format'
import { captureHouse } from '../../lib/gps'
import { requestTransport } from '../../lib/relay'
import { toClient } from '../../lib/register'
import { changed, env, pushNativeState, sendDue } from '../../lib/runtime'
import { useQuery } from '../../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Heading, Label, Loading, Screen } from '../../ui/kit'
import { space } from '../../ui/theme'

export default function ClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [gps, setGps] = useState<string | null>(null)
  const { data } = useQuery(async () => {
    const { db } = env()
    const c = await db.get<any>('SELECT * FROM clients WHERE id = ?', [id])
    if (!c) return null
    const h = await db.get<{ id: string; head_name: string; community: string; landmark: string; lat: number | null; lng: number | null }>('SELECT * FROM households WHERE id = ?', [c.household_id])
    const visits = await db.all<{ id: string; visited_at: number; outcome: string; rule_id: string; protocol_id: string }>('SELECT id, visited_at, outcome, rule_id, protocol_id FROM visits WHERE client_id = ? AND deleted = 0 ORDER BY visited_at DESC LIMIT 10', [id])
    const refs = await db.all<{ id: string; short_id: string; created_at: number }>('SELECT id, short_id, created_at FROM referrals WHERE client_id = ? ORDER BY created_at DESC', [id])
    const due = await db.get<{ followup_due: number }>('SELECT followup_due FROM visits WHERE client_id = ? AND deleted = 0 AND followup_due IS NOT NULL ORDER BY visited_at DESC LIMIT 1', [id])
    const providers = await db.all<{ id: string; name: string; vehicle: string }>('SELECT id, name, vehicle FROM transport_providers WHERE active = 1 AND deleted = 0 ORDER BY name')
    const booked = await db.get<{ status: string; scheduled_for: number }>("SELECT status, scheduled_for FROM transport_requests WHERE client_id = ? AND referral_id IS NULL AND status IN ('requested', 'coming') ORDER BY requested_at DESC LIMIT 1", [id])
    return { client: toClient(c), next_of_kin: c.next_of_kin as string | null, household: h, visits, refs, due: due?.followup_due ?? null, providers, booked }
  }, [id])

  if (data === undefined) return <Loading />
  if (data === null) return <Screen title="Client not found"><Button label="Back" onPress={() => router.back()} /></Screen>
  const { client, household, visits, refs } = data
  const birth = client.type === 'postpartum' ? client.delivery_date : client.dob
  const ageDays = birth !== null ? Math.floor((Date.now() - birth) / 86_400_000) : null
  const protocol = protocolIdFor(client.type, client.type === 'child' || client.type === 'newborn' ? ageDays : null)

  async function fixGps() {
    setGps('Finding the house position. Stand at the door.')
    const fix = await captureHouse(12_000, (n, best) => setGps(`Reading ${n}, best accuracy ${Math.round(best)} m`))
    if (!fix || !household) { setGps('Could not get a position. Location may be off.'); return }
    await env().db.run('UPDATE households SET lat = ?, lng = ?, updated_at = ?, device_id = ?, synced = 0 WHERE id = ?', [fix.lat, fix.lng, Date.now(), env().self.device_id, household.id])
    setGps(`Saved, accurate to about ${fix.accuracy} m.`)
    changed()
  }

  return (
    <Screen title={client.name} subtitle={`${TYPE_NAME[client.type]} · ${client.code}`} right={<Button tone="quiet" label="Back" onPress={() => router.back()} />}>
      <Button label="Start visit checklist" onPress={() => router.push(`/visit/${client.id}?protocol=${protocol}`)} />
      <Card>
        <Label>Details</Label>
        {client.type === 'pregnant' && client.edd ? <Body>Due {new Date(client.edd).toLocaleDateString()} · pregnancy {client.parity === 0 ? 'first' : `number ${(client.parity ?? 0) + 1}`}</Body> : null}
        {client.type === 'postpartum' && client.delivery_date ? <Body>Delivered {ago(client.delivery_date)}</Body> : null}
        {client.dob ? <Body>{ageText(client.dob)}{client.birth_weight_g ? ` · born ${client.birth_weight_g} g` : ''}</Body> : null}
        {client.prior_complications.length ? <Body>Previous: {client.prior_complications.join(', ').replace(/_/g, ' ')}</Body> : null}
        <Body>NHIS {client.nhis_active ? 'active' : 'not active'}{data.next_of_kin ? ` · next of kin ${data.next_of_kin}` : ''}</Body>
      </Card>
      {household ? (
        <Card>
          <Label>House</Label>
          <Body>{household.head_name}, {household.community}</Body>
          <Body muted>{household.landmark}</Body>
          <Body muted>{household.lat !== null ? `GPS ${household.lat.toFixed(5)}, ${household.lng!.toFixed(5)}` : 'No GPS position yet'}</Body>
          <Button tone="plain" label={household.lat !== null ? 'Update house position' : 'Capture house position'} onPress={fixGps} />
          {gps ? <Banner text={gps} /> : null}
        </Card>
      ) : null}
      {data.due && data.due > Date.now() - 86_400_000 ? (
        <Card>
          <Label>Follow-up {new Date(data.due).toLocaleDateString()}</Label>
          {data.booked ? <Body>Driver {data.booked.status === 'coming' ? 'confirmed' : 'asked; waiting for a reply'} for {new Date(data.booked.scheduled_for).toLocaleDateString()}.</Body> : (
            <>
              <Body muted>If she must travel to the compound, book a driver. He is texted the day before.</Body>
              {data.providers.map((p) => (
                <Button key={p.id} tone="plain" label={`Book ${p.name} (${p.vehicle || 'driver'})`} onPress={async () => {
                  const at = new Date(data.due!); at.setHours(9, 0, 0, 0)
                  await requestTransport(env(), { client_id: client.id, provider_id: p.id, scheduled_for: at.getTime() })
                  await pushNativeState(); changed(); void sendDue()
                }} />
              ))}
            </>
          )}
        </Card>
      ) : null}
      {refs.length ? (
        <View style={{ gap: space.sm }}>
          <Heading>Referrals</Heading>
          {refs.map((r) => <Card key={r.id} onPress={() => router.push(`/referral/${r.id}`)}><Body>Referral {r.short_id} · {ago(r.created_at)}</Body></Card>)}
        </View>
      ) : null}
      <Heading>Visits</Heading>
      {visits.length === 0 ? <Body muted>No visits recorded yet.</Body> : visits.map((v) => {
        const t = outcomeTone(v.outcome)
        return (
          <Card key={v.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body>{new Date(v.visited_at).toLocaleDateString()}</Body>
              <Chip label={t.label} fg={t.fg} bg={t.bg} />
            </View>
            <Body muted>Rule {v.rule_id}</Body>
          </Card>
        )
      })}
    </Screen>
  )
}
