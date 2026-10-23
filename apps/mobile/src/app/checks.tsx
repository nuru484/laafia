import { router } from 'expo-router'
import { Linking, View } from 'react-native'
import { LaafiaSms } from 'laafia-sms'
import { readChecks, requestLocation, requestNotifications, requestSms } from '../lib/permissions'
import { currentSession, pushNativeState } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Body, Button, Card, Chip, Label, Loading, Screen } from '../ui/kit'
import { color, space } from '../ui/theme'

function Row({ ok, title, why, action, onChange }: { ok: boolean; title: string; why: string; action?: { label: string; run: () => unknown }; onChange?: () => void }) {
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Body style={{ fontWeight: '700', flex: 1 }}>{title}</Body>
        <Chip label={ok ? 'Ready' : 'Needs action'} fg={ok ? color.routine : color.refer} bg={ok ? color.routineBg : color.referBg} />
      </View>
      <Body muted>{why}</Body>
      {!ok && action ? <Button label={action.label} onPress={async () => { await action.run(); onChange?.() }} /> : null}
    </Card>
  )
}
/** Everything the phone must allow for referrals to work with the app closed (PLAN.md, background survival). */
export default function Checks() {
  const q = useQuery(readChecks)
  const c = q.data
  const facility = currentSession()?.role === 'facility'
  if (!c) return <Loading />
  const maker = c.power.manufacturer
  return (
    <Screen title="Phone setup" subtitle={`${maker} ${c.power.model} · Android API ${c.power.sdk}`} onBack={() => router.back()}>
      <Row onChange={q.reload} ok={c.sms} title="Send and read SMS" why={`Referrals, acknowledgements and clients' booking texts travel by SMS.${c.sms ? '' : ' If Android does not ask, or calls it a restricted setting: in App info tap the ⋮ menu, choose Allow restricted settings, then allow SMS under Permissions.'}`}
        action={{ label: 'Allow SMS', run: async () => { if (!(await requestSms())) await Linking.openSettings(); await pushNativeState() } }} />
      <Row onChange={q.reload} ok={c.notifications} title="Notifications" why={facility ? 'An incoming referral rings like an alarm, even when the app is closed.' : 'Shows when the facility acknowledges a referral.'} action={{ label: 'Allow notifications', run: requestNotifications }} />
      {facility ? <Row onChange={q.reload} ok={c.power.canUseFullScreenIntent} title="Alarm over the lock screen" why="Lets an emergency referral wake the screen." action={{ label: 'Open setting', run: () => LaafiaSms.openFullScreenIntentSettings() }} /> : null}
      <Row onChange={q.reload} ok={c.power.ignoringBatteryOptimizations} title="Battery: never restrict Laafia" why="Battery savers stop apps in the background, and a stopped app misses SMS." action={{ label: 'Allow', run: () => LaafiaSms.requestIgnoreBatteryOptimizations() }} />
      <Card>
        <Label>{maker} app sleep and autostart</Label>
        <Body muted>{/samsung/i.test(maker) ? 'Samsung: Settings, Battery, Background usage limits. Remove Laafia from Sleeping and Deep sleeping apps and add it to Never sleeping apps.' : /tecno|infinix|itel/i.test(maker) ? 'Phone Master: Auto-start manager, turn Laafia on. Also lock Laafia in recent apps.' : 'Allow Laafia to auto-start and run in the background.'} Android does not report this setting, so check it by hand.</Body>
        <Button tone="plain" label="Open the setting" onPress={() => LaafiaSms.openAutostartSettings()} />
      </Card>
      <Row onChange={q.reload} ok={c.location} title="Location" why="Records where each house is, for the visit route and directions." action={{ label: 'Allow location', run: requestLocation }} />
      <Row onChange={q.reload} ok={c.power.verifierOk} title="Signature check" why="The SMS receiver can verify Laafia signatures on this phone." />
    </Screen>
  )
}
