import { router } from 'expo-router'
import { useState } from 'react'
import { Linking, View } from 'react-native'
import { addProvider, setProviderActive } from '../lib/register'
import { changed, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Button, Card, Field, Heading, Loading, Screen } from '../ui/kit'
import { space } from '../ui/theme'

export default function Drivers() {
  const { data } = useQuery(() => env().db.all<{ id: string; name: string; phone: string; vehicle: string; community: string; active: number }>('SELECT * FROM transport_providers WHERE deleted = 0 ORDER BY active DESC, community, name'))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [community, setCommunity] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setError(null)
    try {
      await addProvider(env(), { name, phone, vehicle, community })
      setName(''); setPhone(''); setVehicle(''); setCommunity('')
      changed()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!data) return <Loading />
  return (
    <Screen title="Drivers" subtitle="Who can take a patient to the facility. They need no app; any phone that reads SMS works." right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      {data.map((p) => (
        <Card key={p.id}>
          <Body style={{ fontWeight: '700' }}>{p.name}{p.active ? '' : ' (retired)'}</Body>
          <Body muted>{p.vehicle || 'Vehicle not given'} · {p.community || 'Any community'} · {p.phone}</Body>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button style={{ flex: 1 }} tone="plain" label="Call" onPress={() => Linking.openURL(`tel:${p.phone}`)} />
            <Button style={{ flex: 1 }} tone="quiet" label={p.active ? 'Retire' : 'Restore'} onPress={async () => { await setProviderActive(env(), p.id, !p.active); changed() }} />
          </View>
        </Card>
      ))}
      <Heading>Add a driver</Heading>
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Vehicle" value={vehicle} onChangeText={setVehicle} placeholder="motor king, taxi, community ambulance" />
      <Field label="Community" value={community} onChangeText={setCommunity} />
      {error ? <Banner tone="refer" text={error} /> : null}
      <Button label="Add driver" onPress={add} disabled={!name.trim() || !phone.trim()} />
    </Screen>
  )
}
