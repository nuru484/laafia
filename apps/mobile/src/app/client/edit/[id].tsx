import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { updateClient, type ClientEdit } from '../../../lib/register'
import { changed, env, pushNativeState } from '../../../lib/runtime'
import { useQuery } from '../../../lib/useQuery'
import { Banner, Button, Card, Field, Label, Loading, Screen } from '../../../ui/kit'

/** Corrects a client's name, phone and house details; the change syncs like any other record. */
export default function EditClient() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data } = useQuery(() => env().db.get<ClientEdit>(
    `SELECT c.name, coalesce(c.phone, '') AS phone, coalesce(c.next_of_kin, '') AS next_of_kin, h.community, h.head_name, h.landmark
       FROM clients c JOIN households h ON h.id = c.household_id WHERE c.id = ?`, [id]), [id])
  const [v, setV] = useState<ClientEdit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data && !v) setV(data) }, [data, v])

  if (!v) return <Loading />
  const set = (k: keyof ClientEdit) => (t: string) => setV({ ...v, [k]: t })

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await updateClient(env(), id, v!)
      // A new phone number changes which texts count as her bookings.
      await pushNativeState()
      changed()
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Edit details" subtitle={data?.name} right={<Button tone="quiet" label="Cancel" onPress={() => router.back()} />}>
      <Card>
        <Label>Person</Label>
        <Field label="Name" value={v.name} onChangeText={set('name')} />
        <Field label="Her phone, for visit texts and reminders" value={v.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label="Next of kin phone" value={v.next_of_kin} onChangeText={set('next_of_kin')} keyboardType="phone-pad" />
      </Card>
      <Card>
        <Label>House</Label>
        <Field label="Community" value={v.community} onChangeText={set('community')} />
        <Field label="Head of household" value={v.head_name} onChangeText={set('head_name')} />
        <Field label="Landmark (how to find the house)" value={v.landmark} onChangeText={set('landmark')} />
      </Card>
      {error ? <Banner tone="refer" text={error} /> : null}
      <Button label="Save" busy={busy} onPress={save} />
    </Screen>
  )
}
