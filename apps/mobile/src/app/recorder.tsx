import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { LANGS, saveClip, speak } from '../lib/audio'
import { allPrompts } from '../lib/prompts'
import { changed, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Heading, Loading, Screen } from '../ui/kit'
import { color, space } from '../ui/theme'

/**
 * Community recording (spec 8): a speaker reads each prompt the way it is
 * asked at the door. Clips are small mono AAC files saved per language.
 */
const PRESET = { ...RecordingPresets.LOW_QUALITY, sampleRate: 22050, numberOfChannels: 1, bitRate: 32000 }

export default function Recorder() {
  const [lang, setLang] = useState('dag')
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorder = useAudioRecorder(PRESET)
  const state = useAudioRecorderState(recorder)
  const prompts = useMemo(allPrompts, [])
  const { data: recorded } = useQuery(async () => new Set((await env().db.all<{ prompt_id: string }>('SELECT prompt_id FROM audio_clips WHERE lang = ?', [lang])).map((r) => r.prompt_id)), [lang])

  async function start(id: string) {
    setError(null)
    const perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) { setError('Microphone permission is needed to record.'); return }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    setActive(id)
  }
  async function finish() {
    if (!active) return
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    if (recorder.uri) await saveClip(env().db, active, lang, recorder.uri)
    setActive(null)
    changed()
  }

  if (!recorded) return <Loading />
  const done = prompts.filter((p) => recorded.has(p.id)).length
  let group = ''
  return (
    <Screen title="Record prompts" subtitle={`${done} of ${prompts.length} recorded in ${LANGS.find((l) => l.code === lang)?.name}`} right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {LANGS.map((l) => <Button key={l.code} tone={lang === l.code ? 'primary' : 'plain'} label={l.name} onPress={() => setLang(l.code)} style={{ flex: 1 }} />)}
      </View>
      <Body muted>Read each line as you would ask it at the door, in a quiet place. Tap Record, speak, tap Stop. Play it back; record again if needed.</Body>
      {error ? <Banner tone="refer" text={error} /> : null}
      {prompts.map((p) => {
        const header = p.group !== group ? (group = p.group) : null
        const isActive = active === p.id
        return (
          <View key={p.id} style={{ gap: space.sm }}>
            {header ? <Heading>{header}</Heading> : null}
            <Card accent={recorded.has(p.id) ? color.routine : color.line}>
              <Body>{p.text_en}</Body>
              {recorded.has(p.id) ? <Chip label="Recorded" fg={color.routine} bg={color.routineBg} /> : null}
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {isActive ? (
                  <Button style={{ flex: 1 }} tone="refer" label={`Stop (${Math.round((state.durationMillis ?? 0) / 1000)} s)`} onPress={finish} />
                ) : (
                  <Button style={{ flex: 1 }} label={recorded.has(p.id) ? 'Record again' : 'Record'} disabled={active !== null} onPress={() => start(p.id)} />
                )}
                {recorded.has(p.id) ? <Button style={{ flex: 1 }} tone="plain" label="Play" disabled={active !== null} onPress={() => speak(env().db, p.id, p.text_en, lang)} /> : null}
              </View>
            </Card>
          </View>
        )
      })}
    </Screen>
  )
}
