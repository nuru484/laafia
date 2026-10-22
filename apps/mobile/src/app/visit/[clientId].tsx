import { PROTOCOLS, evaluate, next, resolveDestination, type Facility, type Question } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { outcomeTone } from '../../features/format'
import { armAckAlarm } from '../../lib/alarms'
import { createReferral } from '../../lib/relay'
import { saveVisit, toClient } from '../../lib/register'
import { changed, currentSession, env, sendDue } from '../../lib/runtime'
import { useQuery } from '../../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Field, Heading, Label, Loading, Screen } from '../../ui/kit'
import { color, radius, space, touch } from '../../ui/theme'

type ProtocolId = keyof typeof PROTOCOLS
const DAY = 86_400_000

export default function Visit() {
  const { clientId, protocol: pid } = useLocalSearchParams<{ clientId: string; protocol: ProtocolId }>()
  const protocol = PROTOCOLS[pid ?? 'child']
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [history, setHistory] = useState<string[]>([])
  const [number, setNumber] = useState('')
  const [saving, setSaving] = useState(false)
  const [destCode, setDestCode] = useState<string | null>(null)

  const { data } = useQuery(async () => {
    const { db } = env()
    const c = await db.get<any>('SELECT * FROM clients WHERE id = ?', [clientId])
    const facilities = (await db.all<any>('SELECT * FROM facilities')).map((f) => ({ ...f, capabilities: JSON.parse(f.capabilities) })) as Facility[]
    const h = c ? await db.get<{ lat: number | null; lng: number | null }>('SELECT lat, lng FROM households WHERE id = ?', [c.household_id]) : undefined
    return c ? { client: toClient(c), facilities, home: h } : null
  }, [clientId])

  // Context the rules may read: client type, age, birth weight (protocol files reference them by name).
  const context = useMemo(() => {
    if (!data) return {}
    const c = data.client
    const birth = c.type === 'postpartum' ? c.delivery_date : c.dob
    const ageDays = birth !== null ? Math.floor((Date.now() - birth) / DAY) : null
    return { client_type: c.type, age_days: ageDays, age_months: ageDays !== null ? Math.floor(ageDays / 30.4) : null, birth_weight_g: c.birth_weight_g }
  }, [data])

  const all = { ...context, ...answers }
  const question = next(protocol, all)
  const result = evaluate(protocol, all)
  const done = question === null

  if (data === undefined) return <Loading />
  if (data === null) return <Screen title="Client not found"><Button label="Back" onPress={() => router.back()} /></Screen>

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

  async function finish(refer: boolean) {
    setSaving(true)
    try {
      const e = env()
      const visitId = await saveVisit(e, { client_id: data!.client.id, protocol_id: protocol.id as ProtocolId, answers, evaluation: result, muac_mm: typeof answers.ch_muac === 'number' ? answers.ch_muac : null })
      if (refer && destination) {
        const { referral } = await createReferral(e, { client_id: data!.client.id, visit_id: visitId, protocol_id: protocol.id as ProtocolId, evaluation: result, destination_code: destination.code })
        await armAckAlarm(e.db, referral.id, referral.short_id, referral.urgency as 1 | 2 | 3)
        changed()
        void sendDue()
        router.replace(`/referral/${referral.id}`)
      } else {
        changed()
        router.back()
      }
    } finally {
      setSaving(false)
    }
  }

  const tone = outcomeTone(result.outcome)
  const answeredCount = history.length
  return (
    <Screen title={data.client.name} subtitle={`Checklist: ${protocol.id.replace('_', ' ')} · question ${answeredCount + (done ? 0 : 1)}`}
      right={<Button tone="quiet" label="Close" onPress={() => router.back()} />}>
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
              <Field label={question.unit ?? 'Value'} value={number} onChangeText={setNumber} keyboardType="decimal-pad" />
              <Button label="Next" disabled={number.trim() === '' || Number.isNaN(Number(number))} onPress={() => answer(question, Number(number))} />
            </View>
          )}
          {history.length ? <Button tone="quiet" label="Back to previous question" onPress={back} /> : null}
        </Card>
      ) : null}

      {result.outcome === 'refer' && !done ? <Button tone="refer" label="Refer now, finish checklist later" onPress={() => finish(true)} busy={saving} disabled={!destination} /> : null}

      {done ? (
        <Card accent={tone.fg}>
          <Chip label={tone.label} fg={tone.fg} bg={tone.bg} />
          <Body muted>Rule {result.rule_id} · from the WHO checklist, not a diagnosis</Body>
          <Label>What to do now</Label>
          {result.actions.map((a) => {
            const act = protocol.actions[a]
            return act ? (
              <View key={a} style={{ minHeight: touch, padding: space.md, borderRadius: radius, backgroundColor: color.bg, borderWidth: 1, borderColor: color.line, justifyContent: 'center' }}>
                <Body>{act.text_en}</Body>
              </View>
            ) : null
          })}
          {result.outcome === 'followup' ? <Body>Follow-up visit in {result.followup_days} day{result.followup_days === 1 ? '' : 's'}; it will appear on the Today list.</Body> : null}
          {result.outcome === 'refer' ? (
            <>
              <Label>Send to</Label>
              {data.facilities.filter((f) => f.level !== 'chps' || f.code === suggested?.code).map((f) => (
                <Pressable key={f.code} onPress={() => setDestCode(f.code)} accessibilityRole="radio" accessibilityState={{ checked: destination?.code === f.code }}
                  style={{ minHeight: touch, padding: space.md, borderRadius: radius, borderWidth: 2, borderColor: destination?.code === f.code ? color.refer : color.line, justifyContent: 'center' }}>
                  <Body style={{ fontWeight: destination?.code === f.code ? '700' : '400' }}>{f.name}{f.code === suggested?.code ? ' (suggested by the checklist)' : ''}</Body>
                </Pressable>
              ))}
              <Button tone="refer" label="Send referral" onPress={() => finish(true)} busy={saving} disabled={!destination} />
            </>
          ) : (
            <Button label="Save visit" onPress={() => finish(false)} busy={saving} />
          )}
          <Button tone="quiet" label="Change last answer" onPress={back} />
        </Card>
      ) : null}
    </Screen>
  )
}
