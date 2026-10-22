import { useState } from 'react'
import { View } from 'react-native'
import { ApiError } from '../lib/api'
import { activate, type ActivationProgress } from '../lib/runtime'
import { Banner, Body, Button, Field, Screen } from '../ui/kit'

const MESSAGES: Record<string, string> = {
  invalid_code: 'That code is not valid, already used, or expired. Ask the district admin for a new one.',
  offline: 'No internet. Activation needs internet once; connect at the facility and try again.',
  rate_limited: 'Too many attempts. Wait 15 minutes and try again.',
  no_api_url: 'This build has no server address. Install the correct Laafia build.',
}

export function Activate({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ActivationProgress | null>(null)

  const codeOk = /^\d{8}$/.test(code.trim())
  const phoneOk = phone.replace(/\D/g, '').length >= 9

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await activate(code, phone, setProgress)
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? MESSAGES[e.code] ?? e.message : 'Activation failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Welcome to Laafia" subtitle="Activate this phone once, at the facility, with internet.">
      <Body muted>Enter the 8-digit activation code from your district admin and this phone's number. Your register then downloads to the phone and works without internet.</Body>
      <Field label="Activation code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} autoFocus />
      <Field label="This phone's number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="024 000 0000" autoComplete="tel" />
      {error ? <Banner tone="refer" text={error} /> : null}
      {progress ? <Banner text={progress.phase === 'activating' ? 'Activating this phone' : `Downloading your register: ${progress.records} records`} /> : null}
      <View style={{ marginTop: 8 }}>
        <Button label="Activate" onPress={submit} disabled={!codeOk || !phoneOk} busy={busy} />
      </View>
    </Screen>
  )
}
