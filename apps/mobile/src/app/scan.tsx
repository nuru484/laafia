import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { View } from 'react-native'
import { TabBar } from '../features/TabBar'
import { processIncoming } from '../lib/relay'
import { changed, currentSession, env, sendDue } from '../lib/runtime'
import { Banner, Body, Button, Screen } from '../ui/kit'
import { space } from '../ui/theme'

const RESULT: Record<string, string> = {
  bad_signature: 'This QR code was changed or damaged. It was not accepted.',
  unknown_signer: 'This referral is from a phone this facility does not know. It was not accepted.',
}

/** Scans a referral QR (spec 13.1): a facility receives it, any other phone carries and forwards it. */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions()
  const [message, setMessage] = useState<{ tone: 'info' | 'refer'; text: string } | null>(null)
  const busy = useRef(false)
  const facility = currentSession()?.role === 'facility'

  async function onScan(data: string) {
    if (busy.current) return
    busy.current = true
    try {
      const r = await processIncoming(env(), { sender: 'qr', body: data, received_at: Date.now(), via: 'qr' })
      if (r.kind === 'referral') {
        changed()
        void sendDue()
        setMessage({ tone: 'info', text: facility ? (r.isNew ? 'Referral received and acknowledged.' : 'Already received; this copy confirms it.') : 'Referral saved. This phone will forward it by SMS when it has signal.' })
        router.push(`/referral/${r.referral_id}`)
      } else if (r.kind === 'duplicate') {
        setMessage({ tone: 'info', text: 'Already scanned.' })
      } else if (r.kind === 'rejected') {
        setMessage({ tone: 'refer', text: RESULT[r.error] ?? `Not accepted (${r.error}).` })
      } else {
        setMessage({ tone: 'refer', text: 'That is not a Laafia referral code.' })
      }
    } finally {
      setTimeout(() => { busy.current = false }, 1500)
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Scan a referral" subtitle={facility ? 'Scan the QR on the CHO or volunteer phone.' : 'Carry a referral to the facility by scanning it.'} scroll={false}>
        {!permission ? null : !permission.granted ? (
          <View style={{ gap: space.md }}>
            <Body>The camera is needed to read referral QR codes.</Body>
            <Button label="Allow camera" onPress={requestPermission} />
          </View>
        ) : (
          <View style={{ flex: 1, gap: space.md, paddingBottom: 72 }}>
            <CameraView style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => void onScan(data)} />
            {message ? <Banner tone={message.tone} text={message.text} /> : <Body muted>Hold the code inside the frame.</Body>}
          </View>
        )}
      </Screen>
      <TabBar />
    </View>
  )
}
