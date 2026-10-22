import { ACK_TIMEOUT_MS, deriveStatus, referralAlert, type ReferralStatus } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { STATUS_TEXT, ago, statusTone } from '../../features/format'
import { facilityUpdate, referOnward, resendReferral } from '../../lib/relay'
import { changed, currentSession, env, sendDue } from '../../lib/runtime'
import { TYPE_LABEL, signLabels } from '../../lib/signs'
import { useQuery } from '../../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Field, Label, Loading, Screen } from '../../ui/kit'
import { color, space } from '../../ui/theme'

const ORDER: ReferralStatus[] = ['created', 'sent', 'received', 'arrived', 'treated', 'closed']

export default function ReferralScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [backup, setBackup] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const role = currentSession()?.role

  const { data } = useQuery(async () => {
    const { db } = env()
    const r = await db.get<any>(
      `SELECT r.*, c.name AS client_name, f.name AS destination_name, f.phone AS destination_phone, d.user_name AS origin_name, d.phone_number AS origin_phone
         FROM referrals r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN facilities f ON f.code = r.destination_code LEFT JOIN devices d ON d.id = r.origin_device_id
        WHERE r.id = ?`, [id])
    if (!r) return null
    const events = await db.all<{ status: ReferralStatus; at: number; via: string; source_device_id: string }>('SELECT status, at, via, source_device_id FROM referral_events WHERE referral_id = ? ORDER BY at', [id])
    const outbox = await db.all<{ status: string; last_error: string | null; recipient: string }>("SELECT status, last_error, recipient FROM outbox WHERE ref_id = ? AND ref_table = 'referrals' ORDER BY created_at DESC LIMIT 1", [id])
    const facilities = await db.all<{ code: string; name: string; level: string }>('SELECT code, name, level FROM facilities ORDER BY level, name')
    const onward = await db.all<{ id: string; destination_code: string; short_id: string }>('SELECT id, destination_code, short_id FROM referrals WHERE parent_referral_id = ?', [id])
    const myCode = (await db.get<{ facility_code: string | null }>('SELECT facility_code FROM devices WHERE id = ?', [env().self.device_id]))?.facility_code ?? null
    return { r, events, lastSms: outbox[0], facilities, onward, myCode }
  }, [id])

  if (data === undefined) return <Loading />
  if (data === null) return <Screen title="Referral not found"><Button label="Back" onPress={() => router.back()} /></Screen>
  const { r, events, lastSms, facilities, onward, myCode } = data
  const status = deriveStatus(events)
  const alert = referralAlert(events, r.urgency, Date.now())
  const tone = statusTone(status)
  const signs = signLabels(r.client_type, JSON.parse(r.sign_codes))
  const isFacility = role === 'facility'
  const reached = (s: ReferralStatus) => ORDER.indexOf(status) >= ORDER.indexOf(s)

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    try {
      await fn()
      changed()
      void sendDue()
    } catch (e) {
      Alert.alert('Could not do that', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen title={`Referral ${r.short_id}`} subtitle={`${TYPE_LABEL[r.client_type] ?? 'Client'} ${r.client_name ?? r.client_code} · urgency ${r.urgency}`}
      right={<Button tone="quiet" label="Back" onPress={() => router.back()} />}>
      <Chip label={STATUS_TEXT[status]} fg={tone.fg} bg={tone.bg} />
      {alert === 'no_ack' && !isFacility ? (
        <Banner tone="refer" text={`No acknowledgement after ${Math.round(ACK_TIMEOUT_MS[r.urgency as 1 | 2 | 3] / 60_000)} minutes. Call the facility, resend, or send to a backup number.`} />
      ) : null}
      {alert === 'not_arrived' ? <Banner tone="followup" text="The facility has not recorded her arrival. Visit the house." /> : null}
      {lastSms?.status === 'pending' && lastSms.last_error ? <Banner tone="followup" text={lastSms.last_error === 'no_service' || lastSms.last_error === 'radio_off' ? 'No signal. The SMS will send by itself when signal returns.' : `SMS failed (${lastSms.last_error}); retrying.`} /> : null}

      <Card accent={color.refer}>
        <Label>Danger signs</Label>
        {signs.map((sgn) => <Body key={sgn}>{sgn}</Body>)}
        <Body muted>Context {r.context} · to {r.destination_name ?? r.destination_code}</Body>
        {isFacility ? <Body muted>From {r.origin_name ?? r.origin_device_id}{r.origin_phone ? `, ${r.origin_phone}` : ''}</Body> : null}
        {r.next_of_kin ? <Body muted>Next of kin {r.next_of_kin}</Body> : null}
      </Card>

      <Card>
        <Label>Progress</Label>
        {ORDER.map((s) => {
          const ev = events.find((e) => e.status === s)
          return (
            <View key={s} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: reached(s) ? color.routine : color.line }} />
              <Body style={{ flex: 1, color: reached(s) ? color.text : color.muted }}>{STATUS_TEXT[s]}</Body>
              {ev ? <Body muted>{ago(ev.at)} · {ev.via}</Body> : null}
            </View>
          )
        })}
      </Card>

      {isFacility ? (
        <Card>
          <Label>At the facility</Label>
          <Button label="Arrived" disabled={reached('arrived')} busy={busy === 'arrived'} onPress={() => act('arrived', () => facilityUpdate(env(), r.id, 'arrived'))} />
          <Button label="Treated" disabled={reached('treated') || !reached('arrived')} busy={busy === 'treated'} onPress={() => act('treated', () => facilityUpdate(env(), r.id, 'treated'))} />
          <Button tone="plain" label="Discharged: close and schedule follow-up" disabled={reached('closed') || !reached('treated')} busy={busy === 'closed'} onPress={() => act('closed', () => facilityUpdate(env(), r.id, 'closed'))} />
          {r.origin_phone ? <Button tone="plain" label={`Call the CHO (${r.origin_phone})`} onPress={() => Linking.openURL(`tel:${r.origin_phone}`)} /> : null}
          <Body muted>Each button texts the CHO automatically.</Body>
        </Card>
      ) : null}
      {isFacility ? (
        <Card>
          <Label>Refer onward</Label>
          {onward.map((o) => (
            <Button key={o.id} tone="plain" label={`Sent on to ${facilities.find((f) => f.code === o.destination_code)?.name ?? o.destination_code} (${o.short_id})`} onPress={() => router.push(`/referral/${o.id}`)} />
          ))}
          {facilities.filter((f) => f.code !== myCode && f.level !== 'chps').map((f) => (
            <Button key={f.code} tone="refer" label={`Refer to ${f.name}`} busy={busy === f.code} disabled={reached('closed')}
              onPress={() => act(f.code, async () => { const n = await referOnward(env(), r.id, f.code); router.push(`/referral/${n.id}`) })} />
          ))}
          <Body muted>Sends the same assessment, signed by this facility. The CHO keeps seeing the progress.</Body>
        </Card>
      ) : (
        <>
          <Card>
            <Label>Reach the facility</Label>
            {r.destination_phone ? <Button tone="plain" label={`Call ${r.destination_name}`} onPress={() => Linking.openURL(`tel:${r.destination_phone}`)} /> : null}
            <Button tone="plain" label="Resend the SMS" busy={busy === 'resend'} disabled={!r.wire} onPress={() => act('resend', () => resendReferral(env(), r.id))} />
            <Field label="Backup number (nurse's own phone)" value={backup} onChangeText={setBackup} keyboardType="phone-pad" />
            <Button tone="plain" label="Send to backup number" disabled={backup.replace(/\D/g, '').length < 9 || !r.wire} busy={busy === 'backup'} onPress={() => act('backup', () => resendReferral(env(), r.id, backup))} />
            <Button tone="plain" label="Call ambulance 112" onPress={() => Linking.openURL('tel:112')} />
          </Card>
        </>
      )}
    </Screen>
  )
}
