import { router } from 'expo-router'
import { useState } from 'react'
import { receiveSlip } from '../lib/relay'
import { changed, env, sendDue } from '../lib/runtime'
import { Banner, Body, Button, Field, Screen } from '../ui/kit'

/** A client arrived with the slip code from her referral note because the SMS never reached this facility. */
export default function Slip() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setProblem(null)
    try {
      const r = await receiveSlip(env(), code)
      if (r.kind !== 'referral') {
        setProblem(r.kind === 'rejected' && r.error === 'unknown_signer'
          ? 'The code checks out, but this phone does not know the CHO who wrote it. Sync with internet, then try again.'
          : 'That code does not check out. Compare each group with the slip; a single wrong letter stops it.')
        return
      }
      changed()
      void sendDue()
      router.replace(`/referral/${r.referral_id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Referral slip code" subtitle="When a client arrives with a code on her referral note and no SMS came." onBack={() => router.back()}>
      <Field required label="Slip code" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} autoFocus placeholder="e.g. D001 73S7WMU3 KS0050 …" />
      <Body muted>As written on the slip, with or without the spaces. Capital or small letters both work.</Body>
      {problem ? <Banner tone="refer" text={problem} /> : null}
      <Button label="Open the referral" busy={busy} disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 27} onPress={open} />
    </Screen>
  )
}
