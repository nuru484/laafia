import type { ClientType } from '@laafia/core'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import { TYPE_NAME } from '../features/format'
import { captureHouse, type Fix } from '../lib/gps'
import { enrol } from '../lib/register'
import { changed, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Button, Card, Field, Label, Screen } from '../ui/kit'
import { color, radius, space, touch } from '../ui/theme'

const DAY = 86_400_000
const TYPES: ClientType[] = ['pregnant', 'postpartum', 'newborn', 'child']
const COMPLICATIONS = [['pph', 'Heavy bleeding after birth'], ['pre_eclampsia', 'Pre-eclampsia'], ['stillbirth', 'Stillbirth'], ['caesarean', 'Caesarean section']] as const

function Choice({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
      style={{ minHeight: touch, paddingHorizontal: space.md, borderRadius: radius, borderWidth: 2, borderColor: on ? color.primary : color.line, backgroundColor: on ? '#E6F4F1' : color.card, justifyContent: 'center' }}>
      <Text style={{ fontSize: 16, color: color.text, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </Pressable>
  )
}

export default function Enrol() {
  const { data: households } = useQuery(() => env().db.all<{ id: string; head_name: string; community: string; landmark: string }>('SELECT id, head_name, community, landmark FROM households WHERE deleted = 0 ORDER BY community, head_name'))
  const [existing, setExisting] = useState<string | null>(null)
  const [community, setCommunity] = useState('')
  const [head, setHead] = useState('')
  const [landmark, setLandmark] = useState('')
  const [fix, setFix] = useState<Fix | null>(null)
  const [gpsNote, setGpsNote] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [type, setType] = useState<ClientType>('pregnant')
  const [name, setName] = useState('')
  const [sex, setSex] = useState<'f' | 'm'>('f')
  const [when, setWhen] = useState('')
  const [parity, setParity] = useState('')
  const [complications, setComplications] = useState<string[]>([])
  const [weight, setWeight] = useState('')
  const [nhis, setNhis] = useState(true)
  const [kin, setKin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const whenLabel = type === 'pregnant' ? 'Weeks pregnant' : type === 'postpartum' ? 'Days since delivery' : type === 'newborn' ? 'Days old' : 'Age in months'
  const n = Number(when)
  const whenOk = when.trim() !== '' && Number.isFinite(n) && n >= 0 && (type === 'pregnant' ? n <= 42 : type === 'child' ? n <= 59 : n <= 60)
  const houseOk = existing !== null || (community.trim() && head.trim())
  const canSave = !!houseOk && consent && name.trim().length > 1 && whenOk

  async function gps() {
    setGpsNote('Stand at the door. Reading position.')
    const f = await captureHouse(12_000, (k, best) => setGpsNote(`Reading ${k}, best ${Math.round(best)} m`))
    setFix(f)
    setGpsNote(f ? `Position saved, about ${f.accuracy} m.` : 'No position. Location may be off; you can save without it.')
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const now = Date.now()
      const isWoman = type === 'pregnant' || type === 'postpartum'
      const { client_id } = await enrol(env(), {
        household: existing ? { id: existing, community: '', head_name: '', landmark: '', lat: null, lng: null, consent: true } : { community, head_name: head, landmark, lat: fix?.lat ?? null, lng: fix?.lng ?? null, consent },
        client: {
          type, name, sex: isWoman ? 'f' : sex,
          edd: type === 'pregnant' ? now + (280 - n * 7) * DAY : null,
          delivery_date: type === 'postpartum' ? now - n * DAY : null,
          dob: type === 'newborn' ? now - n * DAY : type === 'child' ? now - Math.round(n * 30.4) * DAY : null,
          parity: isWoman && parity !== '' ? Number(parity) : null,
          prior_complications: isWoman ? complications : [],
          birth_weight_g: !isWoman && weight !== '' ? Number(weight) : null,
          nhis_active: nhis, next_of_kin: kin.trim() || null,
        },
      })
      changed()
      router.replace(`/client/${client_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Enrol" subtitle="A household and one person. Names stay on this phone and the server; SMS carries only the code." right={<Button tone="quiet" label="Cancel" onPress={() => router.back()} />}>
      <Card>
        <Label>Household</Label>
        {households?.length ? (
          <View style={{ gap: space.sm }}>
            <Body muted>Existing household, or a new one below.</Body>
            {households.slice(0, 40).map((h) => <Choice key={h.id} label={`${h.head_name}, ${h.community}`} on={existing === h.id} onPress={() => setExisting(existing === h.id ? null : h.id)} />)}
          </View>
        ) : null}
        {existing === null ? (
          <View style={{ gap: space.md }}>
            <Field label="Community" value={community} onChangeText={setCommunity} />
            <Field label="Head of household" value={head} onChangeText={setHead} />
            <Field label="Landmark (how a driver finds the house)" value={landmark} onChangeText={setLandmark} placeholder="behind the mosque, blue gate" />
            <Button tone="plain" label={fix ? 'Capture position again' : 'Capture house position'} onPress={gps} />
            {gpsNote ? <Banner text={gpsNote} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Switch value={consent} onValueChange={setConsent} accessibilityLabel="Verbal consent given" />
              <Body style={{ flex: 1 }}>The household gave verbal consent to be recorded.</Body>
            </View>
          </View>
        ) : null}
      </Card>
      <Card>
        <Label>Person</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {TYPES.map((t) => <Choice key={t} label={TYPE_NAME[t]!} on={type === t} onPress={() => { setType(t); setWhen('') }} />)}
        </View>
        <Field label="Name" value={name} onChangeText={setName} placeholder={type === 'newborn' ? 'Baby of ...' : ''} />
        {type === 'newborn' || type === 'child' ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Choice label="Girl" on={sex === 'f'} onPress={() => setSex('f')} />
            <Choice label="Boy" on={sex === 'm'} onPress={() => setSex('m')} />
          </View>
        ) : null}
        <Field label={whenLabel} value={when} onChangeText={setWhen} keyboardType="number-pad" error={when && !whenOk ? 'Check this number' : null} />
        {type === 'pregnant' || type === 'postpartum' ? (
          <>
            <Field label="Previous births" value={parity} onChangeText={setParity} keyboardType="number-pad" />
            <Label>Previous complications</Label>
            {COMPLICATIONS.map(([k, label]) => <Choice key={k} label={label} on={complications.includes(k)} onPress={() => setComplications((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))} />)}
          </>
        ) : (
          <Field label="Birth weight (grams, if known)" value={weight} onChangeText={setWeight} keyboardType="number-pad" />
        )}
        <Field label="Next of kin phone" value={kin} onChangeText={setKin} keyboardType="phone-pad" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Switch value={nhis} onValueChange={setNhis} accessibilityLabel="NHIS active" />
          <Body>NHIS card active</Body>
        </View>
      </Card>
      {error ? <Banner tone="refer" text={error} /> : null}
      <Button label="Save" onPress={save} busy={busy} disabled={!canSave} />
      {!consent && existing === null ? <Body muted>Recording consent is required before saving.</Body> : null}
    </Screen>
  )
}
