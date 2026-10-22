import { ACK_TIMEOUT_MS, deriveStatus, referralAlert, type ReferralStatus } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { STATUS_TEXT, ago, statusTone } from '../../features/format'
import { facilityUpdate, requestTransport, resendReferral } from '../../lib/relay'
import { changed, currentSession, env, pushNativeState, sendDue } from '../../lib/runtime'
import { TYPE_LABEL, signLabels } from '../../lib/signs'
import { useQuery } from '../../lib/useQuery'
import { Banner, Body, Button, Card, Chip, Field, Heading, Label, Loading, Screen } from '../../ui/kit'
import { color, space } from '../../ui/theme'

const ORDER: ReferralStatus[] = ['created', 'sent', 'received', 'arrived', 'treated', 'closed']
const TRANSPORT_TEXT: Record<string, string> = { requested: 'Waiting for a reply', coming: 'Coming', declined: 'Cannot come', done: 'Done' }

export default function ReferralScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [showQr, setShowQr] = useState(false)
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
    const providers = await db.all<{ id: string; name: string; phone: string; vehicle: string; community: string }>('SELECT * FROM transport_providers WHERE active = 1 AND deleted = 0 ORDER BY community, name')
    const requests = await db.all<{ id: string; provider_id: string; status: string; requested_at: number }>('SELECT id, provider_id, status, requested_at FROM transport_requests WHERE referral_id = ? ORDER BY requested_at DESC', [id])
    const outbox = await db.all<{ status: string; last_error: string | null; recipient: string }>("SELECT status, last_error, recipient FROM outbox WHERE ref_id = ? AND ref_table = 'referrals' ORDER BY created_at DESC LIMIT 1", [id])
    return { r, events, providers, requests, lastSms: outbox[0] }
  }, [id])

  if (data === undefined) return <Loading />
  if (data === null) return <Screen title="Referral not found"><Button label="Back" onPress={() => router.back()} /></Screen>
  const { r, events, providers, requests, lastSms } = data
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
      // A new transport request adds the driver to the numbers the SMS receiver watches.
      await pushNativeState()
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
          {r.wire ? (
            <Card>
              <Label>Hand-carry by QR</Label>
              <Body muted>Any Laafia phone that scans this carries the referral and forwards it when it finds signal. No internet needed.</Body>
              {showQr ? (
                <View style={{ alignItems: 'center', padding: space.md, backgroundColor: '#fff' }} accessibilityLabel="Referral QR code">
                  <QRCode value={r.wire} size={240} ecl="M" />
                </View>
              ) : null}
              <Button tone="plain" label={showQr ? 'Hide QR code' : 'Show QR code'} onPress={() => setShowQr((v) => !v)} />
            </Card>
          ) : null}
          <Heading>Transport</Heading>
          {requests.map((t) => {
            const p = providers.find((x) => x.id === t.provider_id)
            return <Card key={t.id}><Body>{p?.name ?? 'Driver'}: {TRANSPORT_TEXT[t.status] ?? t.status}</Body><Body muted>Asked {ago(t.requested_at)}</Body></Card>
          })}
          {requests.some((t) => t.status === 'declined') || (requests[0] && requests[0].status === 'requested' && Date.now() - requests[0].requested_at > 5 * 60_000) ? (
            <Banner tone="followup" text="No driver confirmed yet. Ask the next driver below, or call 112." />
          ) : null}
          {providers.length === 0 ? <Body muted>No drivers registered for this community.</Body> : providers.map((p) => (
            <Card key={p.id}>
              <Body style={{ fontWeight: '700' }}>{p.name}</Body>
              <Body muted>{p.vehicle} · {p.community}</Body>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button style={{ flex: 1 }} label="Text pickup" busy={busy === p.id} disabled={requests.some((t) => t.provider_id === p.id && (t.status === 'requested' || t.status === 'coming'))}
                  onPress={() => act(p.id, () => requestTransport(env(), { referral_id: r.id, provider_id: p.id }))} />
                <Button style={{ flex: 1 }} tone="plain" label="Call" onPress={() => Linking.openURL(`tel:${p.phone}`)} />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  )
}
