import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { buildFrames } from '../lib/qrsync'
import { env } from '../lib/runtime'
import { Body, Button, Empty, Loading, Screen } from '../ui/kit'
import { space } from '../ui/theme'

/** Shows this phone's unsynced records as a loop of QR frames for another Laafia phone to scan. */
export default function Share() {
  const [frames, setFrames] = useState<string[] | null>(null)
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => { void buildFrames(env()).then(setFrames) }, [])
  useEffect(() => {
    if (!frames?.length || paused) return
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 2000)
    return () => clearInterval(t)
  }, [frames, paused])

  if (!frames) return <Loading label="Preparing records" />
  return (
    <Screen title="Share records" subtitle="The other phone opens More, Receive records, and points its camera here." right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      {frames.length === 0 ? <Empty title="Nothing to share" body="Every record on this phone is already uploaded." /> : (
        <View style={{ gap: space.md, alignItems: 'center' }}>
          <View style={{ padding: space.md, backgroundColor: '#fff', borderRadius: 12 }} accessibilityLabel={`QR frame ${i + 1} of ${frames.length}`}>
            <QRCode value={frames[i]!} size={280} ecl="L" />
          </View>
          <Body>Frame {i + 1} of {frames.length}{paused ? ' (paused)' : ''}</Body>
          <View style={{ flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' }}>
            <Button style={{ flex: 1 }} tone="plain" label="Previous" onPress={() => setI((x) => (x - 1 + frames.length) % frames.length)} />
            <Button style={{ flex: 1 }} tone="plain" label={paused ? 'Play' : 'Pause'} onPress={() => setPaused((p) => !p)} />
            <Button style={{ flex: 1 }} tone="plain" label="Next" onPress={() => setI((x) => (x + 1) % frames.length)} />
          </View>
          <Body muted>Frames change every 2 seconds. The other phone can scan them in any order.</Body>
        </View>
      )}
    </Screen>
  )
}
