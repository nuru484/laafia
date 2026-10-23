import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Switch, View } from 'react-native'
import { Text } from '../ui/text'
import { TabBar } from '../features/TabBar'
import { ago } from '../features/format'
import { biometricAvailable, biometricOn, setBiometricOn } from '../lib/biometric'
import { setUnlocked } from '../lib/lock'
import { currentSession, deactivateLocally, env, getSyncState, syncNow } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { confirm } from '../ui/confirm'
import { ActionList, ActionRow, Banner, Button, Card, Screen, SectionHead, Stats } from '../ui/kit'
import { color, font, space } from '../ui/theme'
import { toast } from '../ui/toast'

const ROLE = { cho: 'Community health officer', facility: 'Facility phone' } as const

async function unsent(): Promise<{ records: number; sms: number }> {
  const { db } = env()
  const records = await db.get<{ n: number }>("SELECT (SELECT count(*) FROM households WHERE synced = 0) + (SELECT count(*) FROM clients WHERE synced = 0) + (SELECT count(*) FROM visits WHERE synced = 0) + (SELECT count(*) FROM referrals WHERE synced = 0) + (SELECT count(*) FROM referral_events WHERE synced = 0) + (SELECT count(*) FROM overrides WHERE synced = 0) AS n")
  const sms = await db.get<{ n: number }>("SELECT count(*) AS n FROM outbox WHERE status IN ('pending', 'sending')")
  return { records: records?.n ?? 0, sms: sms?.n ?? 0 }
}

export default function More() {
  const s = currentSession()
  const sync = getSyncState()
  const { data } = useQuery(unsent)
  const [bio, setBio] = useState<{ available: boolean; on: boolean } | null>(null)
  const role = s?.role

  useEffect(() => {
    void Promise.all([biometricAvailable(), biometricOn()]).then(([available, on]) => setBio({ available, on }))
  }, [])

  async function toggleBio(on: boolean) {
    await setBiometricOn(on)
    setBio((b) => (b ? { ...b, on } : b))
    toast(on ? 'Fingerprint or face unlock is on' : 'Unlock with the PIN only')
  }

  async function signOut() {
    // Nothing recorded here may be lost: upload first, and refuse while anything is still waiting.
    if ((await unsent()).records) await syncNow()
    const left = await unsent()
    if (left.records || left.sms) {
      await confirm({
        title: 'Not everything has left this phone',
        body: `${left.records ? `${left.records} records are not on the server yet` : ''}${left.records && left.sms ? ' and ' : ''}${left.sms ? `${left.sms} SMS are waiting to send` : ''}. Connect to the internet and wait for signal, then sign out.`,
        confirm: 'OK', cancel: null,
      })
      return
    }
    const ok = await confirm({
      title: 'Sign out of this phone?',
      body: 'Everything is synced. The register is removed from this phone and it returns to activation. To use it again, ask the district for a new code on the Nurses page.',
      confirm: 'Sign out and remove data', tone: 'refer',
    })
    if (ok) await deactivateLocally()
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen title="More">
        <View style={st.profile}>
          <View style={st.avatar}><Text style={st.avatarText}>{(s?.user_name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</Text></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.name} numberOfLines={1}>{s?.user_name}</Text>
            <Text style={st.meta} numberOfLines={2}>{role ? ROLE[role] : ''} · {s?.facility.name}</Text>
          </View>
        </View>

        <Card>
          <SectionHead title="Sync" note={sync.last_ok ? `Last synced ${ago(sync.last_ok)}` : 'Not synced yet'} />
          <Stats items={[
            { value: data?.records ?? '–', label: 'Records waiting to upload', tone: data?.records ? color.followup : undefined },
            { value: data?.sms ?? '–', label: 'SMS waiting to send', tone: data?.sms ? color.followup : undefined },
          ]} />
          {sync.last_error ? <Banner tone="followup" text={sync.last_error} /> : null}
          <Button label="Sync now" icon="sync-outline" busy={sync.running} onPress={() => void syncNow().then((r) => toast(r.last_error ? `Sync failed: ${r.last_error}` : 'Up to date with the server', r.last_error ? 'error' : 'ok'))} />
        </Card>

        <ActionList title="Records">
          {role === 'facility' ? <ActionRow icon="search-outline" title="Look up a client" detail="By the code on a referral, or by name" onPress={() => router.push('/lookup')} /> : null}
          <ActionRow icon="document-text-outline" title="Monthly report" detail="Print it or save it as a PDF" onPress={() => router.push('/report')} />
          <ActionRow icon="phone-portrait-outline" title="Phone setup checks" detail="SMS, notifications, battery and location" onPress={() => router.push('/checks')} />
          <ActionRow icon="book-outline" title="How to use Laafia" detail={role === 'facility' ? 'Receiving referrals, step by step' : 'Your day, visits, referrals and more'} onPress={() => router.push('/guide')} />
        </ActionList>

        <ActionList title="Security">
          {bio?.available ? (
            <ActionRow icon="finger-print" title="Unlock with fingerprint or face" detail="The PIN always works too"
              trailing={<Switch value={bio.on} onValueChange={(v) => void toggleBio(v)} trackColor={{ true: color.primary, false: color.line }} thumbColor={color.card} accessibilityLabel="Unlock with fingerprint or face" />} />
          ) : null}
          <ActionRow icon="lock-closed-outline" title="Lock now" detail="Asks for the PIN to open again" onPress={() => setUnlocked(false)} />
          <ActionRow icon="log-out-outline" tone="refer" title="Sign out of this phone" detail="Removes the register from this phone" onPress={() => void signOut()} />
        </ActionList>
      </Screen>
      <TabBar />
    </View>
  )
}

const st = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primaryBg },
  avatarText: { fontSize: font.body + 2, fontWeight: '700', color: color.primary },
  name: { fontSize: font.body + 2, fontWeight: '700', color: color.text },
  meta: { fontSize: font.small, color: color.muted },
})
