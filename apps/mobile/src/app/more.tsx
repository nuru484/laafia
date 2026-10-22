import { router } from 'expo-router'
import { View } from 'react-native'
import { TabBar } from '../features/TabBar'
import { ago } from '../features/format'
import { setUnlocked } from '../lib/lock'
import { currentSession, env, getSyncState, syncNow } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Button, Card, Label, Screen } from '../ui/kit'

export default function More() {
  const s = currentSession()
  const sync = getSyncState()
  const { data } = useQuery(async () => {
    const { db } = env()
    const pending = await db.get<{ n: number }>("SELECT (SELECT count(*) FROM households WHERE synced = 0) + (SELECT count(*) FROM clients WHERE synced = 0) + (SELECT count(*) FROM visits WHERE synced = 0) + (SELECT count(*) FROM referrals WHERE synced = 0) + (SELECT count(*) FROM referral_events WHERE synced = 0) AS n")
    const sms = await db.get<{ n: number }>("SELECT count(*) AS n FROM outbox WHERE status IN ('pending', 'sending')")
    return { pending: pending?.n ?? 0, sms: sms?.n ?? 0 }
  })
  const role = s?.role
  return (
    <View style={{ flex: 1 }}>
      <Screen title="More" subtitle={`${s?.user_name ?? ''} · ${s?.facility.name ?? ''} · ${role ?? ''} mode`}>
        <Card>
          <Label>Sync</Label>
          <Body>{data ? `${data.pending} records waiting to upload · ${data.sms} SMS waiting to send` : ' '}</Body>
          <Body muted>{sync.last_ok ? `Last synced ${ago(sync.last_ok)}` : 'Not synced yet on this phone'}</Body>
          {sync.last_error ? <Banner tone="followup" text={sync.last_error} /> : null}
          <Button label="Sync now" busy={sync.running} onPress={() => void syncNow()} />
        </Card>
        {role === 'facility' ? <Button tone="plain" label="Look up a client" onPress={() => router.push('/lookup')} /> : null}
        <Button tone="plain" label="Monthly report" onPress={() => router.push('/report')} />
        <Button tone="plain" label="Phone setup checks" onPress={() => router.push('/checks')} />
        <Button tone="quiet" label="Lock now" onPress={() => setUnlocked(false)} />
      </Screen>
      <TabBar />
    </View>
  )
}
