import { PROTOCOLS, evaluate, haversineKm, next, resolveDestination, type Facility, type Question } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../../ui/text'
import { outcomeTone } from '../../features/format'
import { armAckAlarm } from '../../lib/alarms'
import { createReferral } from '../../lib/relay'
import { saveVisit, toClient } from '../../lib/register'
import NetInfo from '@react-native-community/netinfo'
import { changed, currentSession, env, pushRegistered, sendDue, syncNow } from '../../lib/runtime'
import { useQuery } from '../../lib/useQuery'
import { Banner, Body, Button, Card, Field, Heading, Label, Loading, Screen } from '../../ui/kit'
import { color, space } from '../../ui/theme'
import { confirm } from '../../ui/confirm'
import { toast } from '../../ui/toast'

type ProtocolId = keyof typeof PROTOCOLS
const DAY = 86_400_000

const shown = (q: Question | undefined, v: unknown) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? `${v}${q?.unit ? ` ${q.unit}` : ''}` : String(v))

export default function Visit() {
  // `visit` reopens a recorded visit, e.g. a referral that did not go out.
  const { clientId, protocol: pid, visit } = useLocalSearchParams<{ clientId: string; protocol: ProtocolId; visit?: string }>()
  const protocol = PROTOCOLS[pid ?? 'child']
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [history, setHistory] = useState<string[]>([])
  const [number, setNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [destCode, setDestCode] = useState<string | null>(null)
  // Kept after a failed referral, so trying again does not record the visit twice.
  const [visitId, setVisitId] = useState<string | null>(visit ?? null)
  const [failed, setFailed] = useState<string | null>(null)

  const { data } = useQuery(async () => {
    const { db } = env()
    const c = await db.get<any>('SELECT * FROM clients WHERE id = ?', [clientId])
    const facilities = (await db.all<any>('SELECT * FROM facilities')).map((f) => ({ ...f, capabilities: JSON.parse(f.capabilities) })) as Facility[]
    const h = c ? await db.get<{ lat: number | null; lng: number | null }>('SELECT lat, lng FROM households WHERE id = ?', [c.household_id]) : undefined
    const saved = visit ? await db.get<{ answers: string }>('SELECT answers FROM visits WHERE id = ?', [visit]) : undefined
    return c ? { client: toClient(c), facilities, home: h, saved: saved ? (JSON.parse(saved.answers) as Record<string, unknown>) : null } : null
  }, [clientId, visit])

  // Context the rules may read: client type, age, birth weight (protocol files reference them by name).
  const context = useMemo(() => {
    if (!data) return {}
    const c = data.client
    const birth = c.type === 'postpartum' ? c.delivery_date : c.dob
    const ageDays = birth !== null ? Math.floor((Date.now() - birth) / DAY) : null
    return { client_type: c.type, age_days: ageDays, age_months: ageDays !== null ? Math.floor(ageDays / 30.4) : null, birth_weight_g: c.birth_weight_g }
  }, [data])

  const all = { ...context, ...(data?.saved ?? answers) }
  const question = next(protocol, all)
  const result = evaluate(protocol, all)
  const done = question === null || !!data?.saved

  if (data === undefined) return <Loading />
  if (data === null) return <Screen title="Client not found" onBack={() => router.back()}><Body muted>It may have been removed on another phone.</Body></Screen>

  const origin = data.home?.lat != null ? { lat: data.home.lat, lng: data.home.lng! } : { lat: currentSession()!.facility.lat, lng: currentSession()!.facility.lng }
  const suggested = result.destination_query ? resolveDestination(result.destination_query, data.facilities, origin) : null
  const destination = data.facilities.find((f) => f.code === destCode) ?? suggested

  function answer(q: Question, value: unknown) {
    setAnswers((a) => ({ ...a, [q.id]: value }))
    setHistory((h) => [...h, q.id])
    setNumber('')
  }
  function back() {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    setAnswers((a) => { const { [last]: _, ...rest } = a; return rest })
  }
  /** Ask again from an earlier question; the answers after it depended on it, so they go too. */
  function rewind(qid: string) {
    const at = history.indexOf(qid)
    if (at < 0) return
    const dropped = new Set(history.slice(at))
    setHistory((h) => h.slice(0, at))
    setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !dropped.has(k))))
  }
  async function leave() {
    if (!data!.saved && !visitId && history.length) {
      const ok = await confirm({ title: 'Leave the checklist?', body: 'The answers so far are not saved.', confirm: 'Leave without saving', cancel: 'Keep going', tone: 'refer' })
      if (!ok) return
    }
    router.back()
  }
  async function sendReferral() {
    if (!destination) return
    const ok = await confirm({
      title: `Refer to ${destination.name}?`,
      body: 'The danger signs go to the facility by SMS now, and the facility is asked to acknowledge. Write the slip code on her referral note in case the SMS does not arrive.',
      confirm: 'Send referral', tone: 'refer',
    })
    if (ok) await finish(true)
  }

  async function finish(refer: boolean) {
    setSaving(true)
    setFailed(null)
    let id = visitId
    try {
      const e = env()
      id ??= await saveVisit(e, { client_id: data!.client.id, protocol_id: protocol.id as ProtocolId, answers, evaluation: result, muac_mm: typeof answers.ch_muac === 'number' ? answers.ch_muac : null })
      setVisitId(id)
      if (refer && destination) {
        // Online with push working, the referral goes by internet first and the SMS waits a little as the backup.
        const internet = (await NetInfo.fetch()).isInternetReachable === true && (await pushRegistered(e))
        const hold = internet ? (result.urgency === 3 ? 45_000 : 90_000) : undefined
        const { referral } = await createReferral(e, { client_id: data!.client.id, visit_id: id, protocol_id: protocol.id as ProtocolId, evaluation: result, destination_code: destination.code, hold_sms_ms: hold })
        await armAckAlarm(e.db, referral.id, referral.short_id, referral.urgency as 1 | 2 | 3)
        changed()
        if (hold) void syncNow()
        else void sendDue()
        toast(hold ? `Referral sent by internet. The SMS follows in ${hold / 1000} s unless the facility confirms first.` : 'Referral saved. Sending the SMS to the facility.')
        router.replace(`/referral/${referral.id}`)
      } else {
        changed()
        toast(result.outcome === 'followup' ? 'Visit saved. The follow-up is on the Today list.' : 'Visit saved')
        router.back()
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      setFailed(id ? `The visit is saved but the referral was not created (${why}). Try again; it is also under the client's visits.` : `The visit was not saved (${why}). Try again.`)
      toast(id ? 'Referral not created. See the message on the screen.' : 'Visit not saved. See the message on the screen.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const tone = outcomeTone(result.outcome)
  const answeredCount = history.length
  return (
    <Screen title={data.client.name} subtitle={`Checklist: ${protocol.id.replace('_', ' ')} · ${data.saved ? 'recorded visit' : done ? 'all questions answered' : `question ${answeredCount + 1}`}`}
      onBack={() => void leave()}>
      {failed ? <Banner tone="refer" text={failed} /> : null}
      {result.outcome === 'refer' ? (
        <Banner tone="refer" text={`Danger sign: ${result.danger_signs.map((s) => protocol.signs[s]?.text_en ?? s).join(', ')}. Refer now (rule ${result.rule_id}).`} />
      ) : null}

      {!done && question ? (
        <Card>
          <Heading>{question.text_en}</Heading>
          {question.type === 'yesno' ? (
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button style={{ flex: 1 }} label="Yes" onPress={() => answer(question, true)} />
              <Button style={{ flex: 1 }} label="No" onPress={() => answer(question, false)} />
            </View>
          ) : question.type === 'select' ? (
            <View style={{ gap: space.sm }}>{question.options?.map((o) => <Button key={o} tone="plain" label={o} onPress={() => answer(question, o)} />)}</View>
          ) : (
            <View style={{ gap: space.sm }}>
              <Field label={question.unit ?? 'Value'} value={number} onChangeText={setNumber} keyboardType="decimal-pad" placeholder={question.unit ? `In ${question.unit}` : 'A number'} />
              <Button label="Next" disabled={number.trim() === '' || Number.isNaN(Number(number))} onPress={() => answer(question, Number(number))} />
            </View>
          )}
          <View style={st.toolbar}>
            <Pressable onPress={back} disabled={!history.length} accessibilityRole="button" accessibilityState={{ disabled: !history.length }}
              style={({ pressed }) => [st.tool, { opacity: history.length ? 1 : 0.4 }, pressed && { backgroundColor: color.primaryBg }]}>
              <Ionicons name="chevron-back" size={18} color={color.primary} />
              <Text style={st.toolText}>Previous question</Text>
            </Pressable>
            <View style={st.toolSplit} />
            <Pressable onPress={() => void leave()} accessibilityRole="button" style={({ pressed }) => [st.tool, pressed && { backgroundColor: color.primaryBg }]}>
              <Ionicons name="close" size={18} color={color.muted} />
              <Text style={[st.toolText, { color: color.muted }]}>Close checklist</Text>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {result.outcome === 'refer' && !done ? <Button tone="refer" label="Refer now, finish checklist later" onPress={() => void sendReferral()} busy={saving} disabled={!destination} /> : null}


      {done ? (
        <View style={st.outcome}>
          <View style={[st.outcomeHead, { backgroundColor: tone.bg }]}>
            <Ionicons name={result.outcome === 'refer' ? 'alert-circle' : result.outcome === 'followup' ? 'time' : 'checkmark-circle'} size={28} color={tone.fg} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[st.outcomeTitle, { color: tone.fg }]}>{tone.label}</Text>
              <Text style={st.outcomeRule}>Rule {result.rule_id} · from the WHO checklist, not a diagnosis</Text>
            </View>
          </View>
          <View style={st.outcomeBody}>
            {result.actions.length ? <Label>What to do now</Label> : null}
            {result.actions.map((a, i) => {
              const act = protocol.actions[a]
              return act ? (
                <View key={a} style={st.todo}>
                  <Text style={st.todoNum}>{i + 1}</Text>
                  <Text style={st.todoText}>{act.text_en}</Text>
                </View>
              ) : null
            })}
            {result.outcome === 'followup' ? (
              <View style={st.todo}>
                <Ionicons name="calendar-outline" size={18} color={color.followup} />
                <Text style={st.todoText}>Follow-up visit in {result.followup_days} day{result.followup_days === 1 ? '' : 's'}; she appears on the Today list then.</Text>
              </View>
            ) : null}
            {result.outcome === 'refer' ? (
              <>
                <Label>Send to</Label>
                <Text style={st.hint}>Nearest first from the house. The suggested one is the closest that can treat these signs.</Text>
                <View style={st.choices} accessibilityRole="radiogroup">
                  {data.facilities.filter((f) => f.level !== 'chps' || f.code === suggested?.code).sort((a, b) => haversineKm(origin, a) - haversineKm(origin, b)).map((f) => {
                    const on = destination?.code === f.code
                    return (
                      <Pressable key={f.code} onPress={() => setDestCode(f.code)} accessibilityRole="radio" accessibilityState={{ checked: on }}
                        accessibilityLabel={`${f.name}, ${haversineKm(origin, f).toFixed(1)} kilometres${f.code === suggested?.code ? ', suggested' : ''}`}
                        style={({ pressed }) => [st.choice, on && st.choiceOn, pressed && !on && { backgroundColor: color.bg }]}>
                        <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? color.refer : color.muted} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[st.choiceName, on && { fontWeight: '700' }]} numberOfLines={2}>{f.name}</Text>
                          <Text style={st.choiceMeta}>
                            {haversineKm(origin, f).toFixed(1)} km · {LEVEL[f.level] ?? f.level}
                            {f.code === suggested?.code ? <Text style={st.suggested}>  ·  Suggested</Text> : null}
                          </Text>
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
                <Button tone="refer" icon="paper-plane" label={destination ? `Send referral to ${destination.name}` : 'Choose a facility'} onPress={() => void sendReferral()} busy={saving} disabled={!destination} />
              </>
            ) : data.saved ? null : (
              <Button label="Save visit" icon="checkmark" onPress={() => finish(false)} busy={saving} />
            )}
            {data.saved || visitId ? null : <Button tone="quiet" label="Change last answer" icon="chevron-back" onPress={back} />}
          </View>
        </View>
      ) : null}
      <Answered protocol={protocol} ids={data.saved ? protocol.questions.map((q) => q.id).filter((id) => id in data.saved!) : history}
        values={data.saved ?? answers} onPick={data.saved || visitId ? undefined : rewind} />
    </Screen>
  )
}

/** The questions asked so far and her answers, in order. Tapping one asks it again (until the visit is saved). */
function Answered({ protocol, ids, values, onPick }: { protocol: (typeof PROTOCOLS)[ProtocolId]; ids: string[]; values: Record<string, unknown>; onPick?: (id: string) => void }) {
  if (!ids.length) return null
  return (
    <View style={{ gap: space.sm }}>
      <Label>Answered so far ({ids.length})</Label>
      <View style={st.answers}>
        {ids.map((id, i) => {
          const q = protocol.questions.find((x) => x.id === id)
          const v = values[id]
          const row = (
            <>
              <Text style={st.qNum}>{i + 1}</Text>
              <Text style={st.qText}>{q?.text_en ?? id}</Text>
              <Text style={st.qAnswer}>{shown(q, v)}</Text>
            </>
          )
          return onPick ? (
            <Pressable key={id} onPress={() => onPick(id)} accessibilityRole="button" accessibilityHint="Asks this question again"
              style={({ pressed }) => [st.answer, pressed && { backgroundColor: color.primaryBg }]}>{row}</Pressable>
          ) : <View key={id} style={st.answer}>{row}</View>
        })}
      </View>
    </View>
  )
}

const LEVEL: Record<string, string> = { chps: 'CHPS compound', health_centre: 'Health centre', hospital: 'Hospital' }

const st = StyleSheet.create({
  outcome: { borderWidth: 1, borderColor: color.line, backgroundColor: color.card },
  outcomeHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  outcomeTitle: { fontSize: 20, fontWeight: '800' },
  outcomeRule: { fontSize: 13, color: color.muted, marginTop: 2 },
  outcomeBody: { padding: space.lg, gap: space.md },
  todo: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  todoNum: { width: 20, fontSize: 15, lineHeight: 22, fontWeight: '700', color: color.muted, fontVariant: ['tabular-nums'] },
  todoText: { flex: 1, fontSize: 16, lineHeight: 22, color: color.text },
  hint: { fontSize: 13, lineHeight: 18, color: color.muted, marginTop: -space.xs },
  choices: { borderTopWidth: 1, borderColor: color.line, marginHorizontal: -space.lg },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.lg, paddingVertical: 8, borderBottomWidth: 1, borderColor: color.line },
  choiceOn: { backgroundColor: color.referBg },
  choiceName: { fontSize: 16, fontWeight: '600', color: color.text },
  choiceMeta: { fontSize: 13, color: color.muted },
  suggested: { fontSize: 13, fontWeight: '700', color: color.routine },
  toolbar: { flexDirection: 'row', marginHorizontal: -space.lg, marginBottom: -space.lg, marginTop: space.sm, borderTopWidth: 1, borderColor: color.line },
  tool: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: space.sm },
  toolSplit: { width: 1, backgroundColor: color.line },
  toolText: { fontSize: 15, fontWeight: '600', color: color.primary },
  answers: { marginHorizontal: -space.lg, backgroundColor: color.card, borderTopWidth: 1, borderColor: color.line },
  answer: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderBottomWidth: 1, borderColor: color.line },
  qNum: { width: 20, fontSize: 14, fontWeight: '700', color: color.muted, fontVariant: ['tabular-nums'] },
  qText: { flex: 1, fontSize: 15, lineHeight: 21, color: color.text },
  qAnswer: { fontSize: 15, fontWeight: '700', color: color.text, maxWidth: '35%', textAlign: 'right' },
})
