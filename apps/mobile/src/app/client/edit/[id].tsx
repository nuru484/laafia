import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { updateClient, type ClientEdit } from '../../../lib/register'
import { changed, env, pushNativeState } from '../../../lib/runtime'
import { useQuery } from '../../../lib/useQuery'
import { Banner, Button, Card, Field, Label, Loading, RequiredNote, Screen } from '../../../ui/kit'
import { toast } from '../../../ui/toast'

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
      toast('Details saved')
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      toast('Not saved. See the message on the screen.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Edit client details" subtitle={data?.name} onBack={() => router.back()}>
      <RequiredNote />
      <Card>
        <Label>Person</Label>
        <Field required label="Name" value={v.name} onChangeText={set('name')} placeholder="e.g. Abena Mensah" />
        <Field label="Her phone, for visit texts and reminders" value={v.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="e.g. 024 123 4567" />
        <Field label="Next of kin phone" value={v.next_of_kin} onChangeText={set('next_of_kin')} keyboardType="phone-pad" placeholder="e.g. 020 987 6543" />
      </Card>
      <Card>
        <Label>House</Label>
        <Field required label="Community" value={v.community} onChangeText={set('community')} placeholder="e.g. Kanshegu" />
        <Field required label="Head of household" value={v.head_name} onChangeText={set('head_name')} placeholder="e.g. Iddrisu Alhassan" />
        <Field label="Landmark (how to find the house)" value={v.landmark} onChangeText={set('landmark')} placeholder="e.g. behind the mosque, blue gate" />
      </Card>
      {error ? <Banner tone="refer" text={error} /> : null}
      <Button label="Save changes" busy={busy} onPress={save} />
    </Screen>
  )
}
