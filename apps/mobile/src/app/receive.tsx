import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { View } from 'react-native'
import { Receiver } from '../lib/qrsync'
import { changed, env } from '../lib/runtime'
import { Banner, Body, Button, Screen } from '../ui/kit'
import { space } from '../ui/theme'

export default function Receive() {
  const [permission, requestPermission] = useCameraPermissions()
  const rx = useRef(new Receiver())
  const [progress, setProgress] = useState({ have: 0, of: 0 })
  const [result, setResult] = useState<{ tone: 'info' | 'refer'; text: string } | null>(null)
  const applying = useRef(false)

  async function onScan(data: string) {
    if (applying.current || !rx.current.add(data)) return
    setProgress(rx.current.progress())
    if (!rx.current.complete()) return
    applying.current = true
    try {
      const r = await rx.current.apply(env())
      changed()
      setResult({ tone: 'info', text: `Received ${r.rows} records. They upload from this phone too when it has internet.` })
    } catch (e) {
      rx.current = new Receiver()
      setProgress({ have: 0, of: 0 })
      setResult({ tone: 'refer', text: e instanceof Error ? e.message : String(e) })
      applying.current = false
    }
  }

  return (
    <Screen title="Receive records" subtitle="Point the camera at the QR loop on the other phone." scroll={false} right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      {!permission ? null : !permission.granted ? (
        <View style={{ gap: space.md }}>
          <Body>The camera is needed to read the record codes.</Body>
          <Button label="Allow camera" onPress={requestPermission} />
        </View>
      ) : (
        <View style={{ flex: 1, gap: space.md }}>
          {!result || result.tone === 'refer' ? <CameraView style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => void onScan(data)} /> : null}
          <Body>{progress.of ? `${progress.have} of ${progress.of} frames` : 'Waiting for the first frame'}</Body>
          {result ? <Banner tone={result.tone} text={result.text} /> : null}
        </View>
      )}
    </Screen>
  )
}
