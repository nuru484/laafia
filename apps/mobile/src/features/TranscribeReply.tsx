import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio'
import { useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { transcribe } from '../lib/runtime'
import { Banner, Body, Button } from '../ui/kit'

const MAX_SECONDS = 10
const ERRORS: Record<string, string> = {
  offline: 'Transcription needs internet. Ask a volunteer to translate instead.',
  khaya_unconfigured: 'Transcription is not set up on the server.',
  rate_limited: 'Too many transcriptions this hour. Try again later.',
  audio_too_long: 'Keep the reply under 10 seconds.',
}

/** Records up to 10 s of the caregiver's answer and shows Khaya's transcript (spec 8). */
export function TranscribeReply({ lang }: { lang: string }) {
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, sampleRate: 16000, numberOfChannels: 1, bitRate: 32000 })
  const state = useAudioRecorderState(recorder)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function start() {
    setError(null)
    setText(null)
    if (!(await requestRecordingPermissionsAsync()).granted) { setError('Microphone permission is needed.'); return }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    timer.current = setTimeout(() => void stopAndSend(), MAX_SECONDS * 1000)
  }
  async function stopAndSend() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!recorder.isRecording) return
    await recorder.stop()
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
    if (!recorder.uri) return
    setBusy(true)
    try {
      setText(await transcribe(recorder.uri, lang))
    } catch (e) {
      setError(e instanceof ApiError ? ERRORS[e.code] ?? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {state.isRecording ? (
        <Button tone="refer" label={`Stop and transcribe (${Math.round((state.durationMillis ?? 0) / 1000)} s)`} onPress={stopAndSend} />
      ) : (
        <Button tone="quiet" label="Record the reply to transcribe (internet)" onPress={start} busy={busy} />
      )}
      {text !== null ? <Body>Reply: {text || '(nothing heard)'}</Body> : null}
      {error ? <Banner tone="followup" text={error} /> : null}
    </>
  )
}
