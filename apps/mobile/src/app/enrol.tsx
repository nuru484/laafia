import type { ClientType } from '@laafia/core'
import { router } from 'expo-router'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { TYPE_NAME } from '../features/format'
import { captureHouse, type Fix } from '../lib/gps'
import { enrol, possibleDuplicates, type PossibleDuplicate } from '../lib/register'
import { changed, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Button, Card, CheckRow, Field, Label, RequiredNote, Screen, Segmented, Select } from '../ui/kit'
import { toast } from '../ui/toast'
import { color, font, space } from '../ui/theme'

const DAY = 86_400_000
const TYPES: ClientType[] = ['pregnant', 'postpartum', 'newborn', 'child']
const TYPE_DETAIL: Record<ClientType, string> = {
  pregnant: 'Antenatal: weeks pregnant',
  postpartum: 'After delivery: days since birth',
  newborn: 'Up to 59 days old',
  child: '2 to 59 months old',
}
const COMPLICATIONS = [['pph', 'Heavy bleeding after birth'], ['pre_eclampsia', 'Pre-eclampsia'], ['stillbirth', 'Stillbirth'], ['caesarean', 'Caesarean section']] as const

export default function Enrol() {
  const { data: households } = useQuery(() => env().db.all<{ id: string; head_name: string; community: string; landmark: string }>('SELECT id, head_name, community, landmark FROM households WHERE deleted = 0 ORDER BY community, head_name'))
  const [existing, setExisting] = useState<string | null>(null)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [hq, setHq] = useState('')
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
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Possible matches already on the register; `different` is the nurse saying this is someone else.
  const [matches, setMatches] = useState<PossibleDuplicate[]>([])
  const [different, setDifferent] = useState(false)

  const whenLabel = type === 'pregnant' ? 'Weeks pregnant' : type === 'postpartum' ? 'Days since delivery' : type === 'newborn' ? 'Days old' : 'Age in months'
  const n = Number(when)
  const whenOk = when.trim() !== '' && Number.isFinite(n) && n >= 0 && (type === 'pregnant' ? n <= 42 : type === 'child' ? n <= 59 : n <= 60)
  const houseOk = mode === 'existing' ? existing !== null : !!(community.trim() && head.trim())
  const chosen = households?.find((h) => h.id === existing) ?? null
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const term = words(hq)
  // A few close matches instead of the whole register, so finding the household stays quick on a long list.
  const found = term.length < 2 ? [] : (households ?? []).filter((h) => words(`${h.head_name} ${h.community} ${h.landmark}`).includes(term)).slice(0, 5)
  // Typing a new head of household who is already registered offers that household instead of a duplicate.
  const similar = mode === 'new' && words(head).length >= 3 ? (households ?? []).filter((h) => words(h.head_name).includes(words(head)) && (!community.trim() || words(h.community) === words(community))).slice(0, 3) : []
  const canSave = !!houseOk && consent && name.trim().length > 1 && whenOk

  async function gps() {
    setGpsNote('Stand outside at the door. With no data the first reading can take a minute.')
    const f = await captureHouse(90_000, (k, best) => setGpsNote(`Reading ${k}, best ${Math.round(best)} m`))
    setFix(f)
    setGpsNote(f ? `Position saved, about ${f.accuracy} m.` : 'No position yet. Check that location is on and step into the open, or save without it and capture it later.')
  }

  async function save(confirmedNew = different) {
    if (!confirmedNew) {
      const found = await possibleDuplicates(env(), { name, type, phone })
      if (found.length) {
        setMatches(found)
        toast('She may already be on the register. Check before enrolling.', 'info')
        return
      }
    }
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
          nhis_active: nhis, next_of_kin: kin.trim() || null, phone: phone.trim() || null,
        },
      })
      changed()
      toast(`${name} enrolled`)
      router.replace(`/client/${client_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      toast('Not enrolled. See the message on the screen.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Enrol" subtitle="A household and one person. Names stay on this phone and the server; SMS carries only the code." onBack={() => router.back()}>
      {/* Consent comes first: nothing below can be filled in until it is recorded (spec 18.3). */}
      <RequiredNote />
      <CheckRow required on={consent} onChange={setConsent} label="The household gave verbal consent to be recorded"
        detail="Ask before writing anything down. Without consent, nobody is enrolled." />
      <View pointerEvents={consent ? 'auto' : 'none'} style={{ gap: space.md, opacity: consent ? 1 : 0.4 }} accessibilityElementsHidden={!consent}>
        <Card>
          <Label>Household</Label>
          {households?.length ? (
            <Segmented label="Where she lives" value={mode} onChange={(m) => { setMode(m); if (m === 'new') setExisting(null) }}
              options={[{ value: 'new', label: 'New household' }, { value: 'existing', label: 'Existing household' }]} />
          ) : null}
          {mode === 'existing' ? (
            chosen ? (
              <View style={st.picked}>
                <Ionicons name="home" size={20} color={color.primary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.matchName} numberOfLines={1}>{chosen.head_name}</Text>
                  <Text style={st.matchMeta} numberOfLines={1}>{chosen.community}{chosen.landmark ? ` · ${chosen.landmark}` : ''}</Text>
                </View>
                <Pressable onPress={() => setExisting(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose another household"><Text style={st.open}>Change</Text></Pressable>
              </View>
            ) : (
              <>
                <Field required label="Find the household" value={hq} onChangeText={setHq} autoCorrect={false} placeholder="Head of household, community or landmark" />
                <View style={st.matches}>
                  {found.map((h) => (
                    <Pressable key={h.id} onPress={() => setExisting(h.id)} accessibilityRole="button" accessibilityLabel={`${h.head_name}, ${h.community}`}
                      style={({ pressed }) => [st.match, pressed && { backgroundColor: color.primaryBg }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={st.matchName} numberOfLines={1}>{h.head_name}</Text>
                        <Text style={st.matchMeta} numberOfLines={1}>{h.community}{h.landmark ? ` · ${h.landmark}` : ''}</Text>
                      </View>
                      <Text style={st.open}>Choose</Text>
                    </Pressable>
                  ))}
                </View>
                {hq.trim().length >= 2 && !found.length ? <Body muted>No household matches. Check the spelling, or enrol a new household.</Body> : null}
              </>
            )
          ) : (
            <View style={{ gap: space.md }}>
              <Field required label="Community" value={community} onChangeText={setCommunity} placeholder="e.g. Kanshegu" />
              <Field required label="Head of household" value={head} onChangeText={setHead} placeholder="e.g. Iddrisu Alhassan" />
              {similar.length ? (
                <View style={st.similar}>
                  <Text style={st.similarTitle}>Already on the register?</Text>
                  {similar.map((h) => (
                    <Pressable key={h.id} onPress={() => { setMode('existing'); setExisting(h.id) }} accessibilityRole="button" accessibilityLabel={`Use ${h.head_name}, ${h.community}`}
                      style={({ pressed }) => [st.match, pressed && { backgroundColor: color.primaryBg }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={st.matchName} numberOfLines={1}>{h.head_name}</Text>
                        <Text style={st.matchMeta} numberOfLines={1}>{h.community}{h.landmark ? ` · ${h.landmark}` : ''}</Text>
                      </View>
                      <Text style={st.open}>Use this household</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Field label="Landmark (how to find the house)" value={landmark} onChangeText={setLandmark} placeholder="e.g. behind the mosque, blue gate" />
              <Button tone="plain" icon="locate-outline" label={fix ? 'Capture position again' : 'Capture house position (optional)'} onPress={gps} />
              {gpsNote ? <Banner text={gpsNote} /> : <Body muted>Only at the house itself. Enrolling at the compound? Skip it: capture it from her client page on the first home visit.</Body>}
            </View>
          )}
        </Card>
        <Card>
          <Label>Person</Label>
          <Select required label="Who is she or he?" value={type} onChange={(t) => { setType(t); setWhen('') }}
            options={TYPES.map((t) => ({ value: t, label: TYPE_NAME[t]!, detail: TYPE_DETAIL[t] }))} />
          <Field required label="Name" value={name} onChangeText={setName} placeholder={type === 'newborn' ? 'e.g. Baby of Amina' : 'e.g. Abena Mensah'} />
          {type === 'newborn' || type === 'child' ? (
            <Segmented required label="Sex" value={sex} onChange={setSex} options={[{ value: 'f', label: 'Girl' }, { value: 'm', label: 'Boy' }]} />
          ) : null}
          <Field required label={whenLabel} value={when} onChangeText={setWhen} keyboardType="number-pad" placeholder="A number" error={when && !whenOk ? 'Check this number' : null} />
          {type === 'pregnant' || type === 'postpartum' ? (
            <>
              <Field label="Previous births" value={parity} onChangeText={setParity} keyboardType="number-pad" placeholder="e.g. 2" />
              <Text style={st.groupLabel}>Previous complications</Text>
              {COMPLICATIONS.map(([k, label]) => <CheckRow key={k} label={label} on={complications.includes(k)} onChange={() => setComplications((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))} />)}
            </>
          ) : (
            <Field label="Birth weight (grams, if known)" value={weight} onChangeText={setWeight} keyboardType="number-pad" placeholder="e.g. 3100" />
          )}
          <Field label="Her phone, for visit texts and reminders" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="e.g. 024 123 4567" />
          <Field label="Next of kin phone" value={kin} onChangeText={setKin} keyboardType="phone-pad" placeholder="e.g. 020 987 6543" />
          <CheckRow on={nhis} onChange={setNhis} label="NHIS card active" />
        </Card>
      </View>
      {error ? <Banner tone="refer" text={error} /> : null}
      {matches.length && !different ? (
        <Card>
          <Label>Already on the register?</Label>
          <Body muted>Open her record if it is the same person. Enrolling her twice splits her visits across two records.</Body>
          <View style={st.matches}>
            {matches.map((m) => (
              <Pressable key={m.id} onPress={() => router.replace(`/client/${m.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${m.name}, ${m.code}, ${m.community}`}
                style={({ pressed }) => [st.match, pressed && { backgroundColor: color.primaryBg }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.matchName} numberOfLines={1}>{m.name}</Text>
                  <Text style={st.matchMeta} numberOfLines={1}>{m.code} · {m.community} · {m.why}</Text>
                </View>
                <Text style={st.open}>Open</Text>
              </Pressable>
            ))}
          </View>
          <Button tone="plain" label="This is a different person: enrol her" onPress={() => { setDifferent(true); void save(true) }} busy={busy} />
        </Card>
      ) : null}
      <Button label="Save" onPress={() => void save()} busy={busy} disabled={!canSave} />
      {!consent ? <Body muted>Tick consent at the top first.</Body> : null}
    </Screen>
  )
}

const st = StyleSheet.create({
  picked: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: color.primaryBg },
  similar: { gap: 2, padding: space.md, paddingBottom: 0, backgroundColor: color.followupBg },
  similarTitle: { fontSize: font.small, fontWeight: '700', color: color.followup },
  groupLabel: { fontSize: font.small, fontWeight: '600', color: color.text, marginTop: space.xs },
  matches: { borderTopWidth: 1, borderColor: color.line },
  match: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderColor: color.line },
  matchName: { fontSize: font.body, fontWeight: '600', color: color.text },
  matchMeta: { fontSize: font.small, color: color.muted },
  open: { fontSize: font.small, fontWeight: '700', color: color.primary },
})
