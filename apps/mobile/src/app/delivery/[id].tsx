import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { DayPicker } from '../../features/DayPicker'
import { dayLabel, dayStart } from '../../lib/bookings'
import { recordDelivery } from '../../lib/register'
import { changed, env } from '../../lib/runtime'
import { useQuery } from '../../lib/useQuery'
import { confirm } from '../../ui/confirm'
import { Banner, Body, Button, Card, Field, Label, Loading, RequiredNote, Screen, Segmented } from '../../ui/kit'
import { space } from '../../ui/theme'
import { toast } from '../../ui/toast'

type Baby = { name: string; sex: 'f' | 'm'; weight: string }

/** She has given birth: the mother moves to after-delivery care and each baby joins the register as a newborn. */
export default function Delivery() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: mother } = useQuery(() => env().db.get<{ name: string; type: string }>('SELECT name, type FROM clients WHERE id = ?', [id]), [id])
  const first = mother?.name.split(' ')[0] ?? ''
  const [day, setDay] = useState<number | null>(dayStart(Date.now()))
  const [outcome, setOutcome] = useState<'live' | 'stillbirth'>('live')
  const [count, setCount] = useState<'1' | '2' | '3'>('1')
  const [babies, setBabies] = useState<Baby[]>([{ name: '', sex: 'f', weight: '' }, { name: '', sex: 'f', weight: '' }, { name: '', sex: 'f', weight: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (mother === undefined) return <Loading />
  if (!mother || mother.type !== 'pregnant') {
    return <Screen title="Record the delivery" onBack={() => router.back()}><Body muted>Only a pregnant client can have a delivery recorded.</Body></Screen>
  }

  const shown = outcome === 'live' ? babies.slice(0, Number(count)) : []
  const nameFor = (i: number) => babies[i]!.name.trim() || `Baby of ${first}${Number(count) > 1 ? ` ${i + 1}` : ''}`
  const set = (i: number, patch: Partial<Baby>) => setBabies((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  async function save() {
    if (day === null) return
    const ok = await confirm({
      title: outcome === 'live' ? `Record the birth on ${dayLabel(day)}?` : `Record the stillbirth on ${dayLabel(day)}?`,
      body: outcome === 'live'
        ? `${mother!.name} moves to after-delivery care, and ${shown.length === 1 ? 'the baby is' : `the ${shown.length} babies are`} added to her household. Newborns come to the top of Today for a visit within 48 hours.`
        : `${mother!.name} moves to after-delivery care, and the stillbirth is kept in her history for her next pregnancy.`,
      confirm: 'Record the delivery',
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await recordDelivery(env(), id, {
        date: day, outcome,
        babies: shown.map((b, i) => ({ name: nameFor(i), sex: b.sex, birth_weight_g: b.weight.trim() ? Number(b.weight) : null })),
      })
      changed()
      toast(outcome === 'live' ? `Delivery recorded. Visit ${shown.length === 1 ? 'the baby' : 'the babies'} within 48 hours.` : 'Delivery recorded.')
      router.back()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      toast('Not recorded. See the message on the screen.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Record the delivery" subtitle={mother.name} onBack={() => router.back()}>
      <RequiredNote />
      <Card>
        <Label>The birth</Label>
        <DayPicker value={day} onChange={setDay} pastDays={60} />
        <Segmented required label="Outcome" value={outcome} onChange={setOutcome} options={[{ value: 'live', label: 'Born alive' }, { value: 'stillbirth', label: 'Stillbirth' }]} />
        {outcome === 'live' ? (
          <Segmented required label="Babies" value={count} onChange={setCount} options={[{ value: '1', label: 'One' }, { value: '2', label: 'Twins' }, { value: '3', label: 'Triplets' }]} />
        ) : null}
      </Card>
      {shown.map((b, i) => (
        <Card key={i}>
          <Label>{shown.length === 1 ? 'The baby' : `Baby ${i + 1}`}</Label>
          <Field label="Name" value={b.name} onChangeText={(t) => set(i, { name: t })} placeholder={nameFor(i)} />
          <Segmented required label="Sex" value={b.sex} onChange={(sex) => set(i, { sex })} options={[{ value: 'f', label: 'Girl' }, { value: 'm', label: 'Boy' }]} />
          <Field label="Birth weight (grams, if known)" value={b.weight} onChangeText={(t) => set(i, { weight: t.replace(/\D/g, '') })} keyboardType="number-pad" placeholder="e.g. 3100" />
        </Card>
      ))}
      {error ? <Banner tone="refer" text={error} /> : null}
      <View style={{ gap: space.sm }}>
        <Button label={day === null ? 'Choose the day of the birth' : `Record the delivery on ${dayLabel(day)}`} icon="checkmark" disabled={day === null} busy={busy} onPress={() => void save()} />
        <Body muted>A blank name is saved as shown in grey; it can be changed later under Edit client details.</Body>
      </View>
    </Screen>
  )
}
