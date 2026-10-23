import { ACK_TIMEOUT_MS, deriveStatus, referralAlert, slipCode, type ReferralStatus } from '@laafia/core'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Linking, Pressable, StyleSheet, View } from 'react-native'
import { Text, TextInput } from '../../ui/text'
import { STATUS_TEXT, ago, statusTone } from '../../features/format'
import { facilityUpdate, referOnward, resendReferral, smsProblem } from '../../lib/relay'
import { changed, currentSession, env, sendDue } from '../../lib/runtime'
import { TYPE_LABEL, signLabels } from '../../lib/signs'
import { useQuery } from '../../lib/useQuery'
import { ActionList, ActionRow, Banner, Body, Button, Card, Chip, Label, Loading, Screen } from '../../ui/kit'
import { color, space } from '../../ui/theme'
import { confirm } from '../../ui/confirm'
import { toast } from '../../ui/toast'

const ORDER: ReferralStatus[] = ['created', 'sent', 'received', 'arrived', 'treated', 'closed']
const DONE: Record<string, string> = {
  arrived: 'Arrival recorded. The CHO is texted.',
  treated: 'Treatment recorded. The CHO is texted.',
  closed: 'Discharged. The CHO is texted and a follow-up visit is scheduled.',
  resend: 'Sending the referral SMS again',
  backup: 'Sending the referral to the backup number',
}

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
  if (data === null) return <Screen title="Referral not found" onBack={() => router.back()}><Body muted>It may not have synced to this phone yet.</Body></Screen>
  const { r, events, lastSms, facilities, onward, myCode } = data
  const status = deriveStatus(events)
  const alert = referralAlert(events, r.urgency, Date.now())
  const tone = statusTone(status)
  const signs = signLabels(r.client_type, JSON.parse(r.sign_codes))
  const isFacility = role === 'facility'
  const reached = (s: ReferralStatus) => ORDER.indexOf(status) >= ORDER.indexOf(s)

  /** `ask` puts a confirmation in front of a step that cannot be taken back. */
  async function act(label: string, fn: () => Promise<unknown>, ask?: { title: string; body: string; confirm: string; tone?: 'primary' | 'refer' }) {
    if (ask && !(await confirm(ask))) return
    setBusy(label)
    try {
      await fn()
      changed()
      void sendDue()
      toast(DONE[label] ?? 'Referred on. Sending the SMS.')
    } catch (e) {
      toast(`Could not do that: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen title={`Referral ${r.short_id}`} subtitle={`${TYPE_LABEL[r.client_type] ?? 'Client'} ${r.client_name ?? r.client_code} · urgency ${r.urgency}`}
      onBack={() => router.back()}>
      <Chip label={STATUS_TEXT[status]} fg={tone.fg} bg={tone.bg} />
      {alert === 'no_ack' && !isFacility ? (
        <Banner tone="refer" text={`No acknowledgement after ${Math.round(ACK_TIMEOUT_MS[r.urgency as 1 | 2 | 3] / 60_000)} minutes. Call the facility, resend, or send to a backup number.`} />
      ) : null}
      {alert === 'not_arrived' ? <Banner tone="followup" text="The facility has not recorded her arrival. Visit the house." /> : null}
      {lastSms?.status === 'pending' && lastSms.last_error ? <Banner tone="followup" text={smsProblem(lastSms.last_error)} /> : null}

      {!isFacility && r.wire ? (
        <Card>
          <Label>Slip code</Label>
          <Body muted>Write it on the referral note she carries. If the SMS does not reach the facility, they type it in and see this referral.</Body>
          <Body style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: '700', letterSpacing: 1 }}>{slipCode(r.wire)}</Body>
        </Card>
      ) : null}

      <Card>
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
          // The time sits under its step, so neither the step nor the time has to wrap.
          return (
            <View key={s} style={st.step}>
              <View style={[st.stepDot, { backgroundColor: reached(s) ? color.routine : color.line }]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[st.stepText, !reached(s) && { color: color.muted }]}>{STATUS_TEXT[s]}</Text>
                {ev ? <Text style={st.stepTime}>{ago(ev.at)} · {VIA[ev.via] ?? ev.via}</Text> : null}
              </View>
            </View>
          )
        })}
      </Card>

      {isFacility ? (
        <ActionList title="At the facility" note="Each step texts the CHO automatically.">
          <ActionRow icon="enter-outline" title="She has arrived" detail="Records her arrival at this facility" done={reached('arrived')} busy={busy === 'arrived'} onPress={() => act('arrived', () => facilityUpdate(env(), r.id, 'arrived'), { title: 'She has arrived?', body: 'The CHO is texted that she reached this facility. A step cannot be taken back.', confirm: 'Record arrival' })} />
          <ActionRow icon="medkit-outline" title="Treated" detail="Treatment given here" done={reached('treated')} disabled={!reached('arrived')} busy={busy === 'treated'} onPress={() => act('treated', () => facilityUpdate(env(), r.id, 'treated'), { title: 'Record treatment?', body: 'The CHO is texted that she has been treated. A step cannot be taken back.', confirm: 'Record treatment' })} />
          <ActionRow icon="home-outline" title="Discharged" detail="Closes the referral and books a home visit in three days" done={reached('closed')} disabled={!reached('treated')} busy={busy === 'closed'} onPress={() => act('closed', () => facilityUpdate(env(), r.id, 'closed'), { title: 'Discharge and close the referral?', body: 'The CHO is texted, and a follow-up home visit appears on her Today list in three days. The referral cannot be reopened.', confirm: 'Discharge' })} />
          {r.origin_phone ? <ActionRow icon="call-outline" title={`Call ${r.origin_name ?? 'the CHO'}`} detail={r.origin_phone} onPress={() => Linking.openURL(`tel:${r.origin_phone}`)} /> : null}
        </ActionList>
      ) : null}
      {isFacility ? (
        <ActionList title="Refer onward" note="Sends the same assessment, signed by this facility. The CHO keeps seeing the progress.">
          {onward.map((o) => (
            <ActionRow key={o.id} icon="git-branch-outline" title={`Sent on to ${facilities.find((f) => f.code === o.destination_code)?.name ?? o.destination_code}`} detail={`Referral ${o.short_id}`} onPress={() => router.push(`/referral/${o.id}`)} />
          ))}
          {facilities.filter((f) => f.code !== myCode && f.level !== 'chps').map((f) => (
            <ActionRow key={f.code} icon="arrow-redo-outline" tone="refer" title={`Refer to ${f.name}`} detail={LEVEL[f.level] ?? f.level} busy={busy === f.code} disabled={reached('closed')}
              onPress={() => act(f.code, async () => { const n = await referOnward(env(), r.id, f.code); router.push(`/referral/${n.id}`) }, { title: `Refer her on to ${f.name}?`, body: 'A new referral with the same danger signs, signed by this facility, goes there by SMS. The CHO keeps seeing the progress.', confirm: 'Refer onward', tone: 'refer' })} />
          ))}
        </ActionList>
      ) : (
        <ActionList title="Reach the facility" note="The backup number gets the same signed SMS: use the facility nurse's own phone.">
          {r.destination_phone ? <ActionRow icon="call-outline" title={`Call ${r.destination_name}`} detail={r.destination_phone} onPress={() => Linking.openURL(`tel:${r.destination_phone}`)} /> : null}
          <ActionRow icon="refresh-outline" title="Resend the SMS" detail={r.destination_phone ? `The same signed text, to ${r.destination_phone}` : 'The same signed text'} busy={busy === 'resend'} disabled={!r.wire} onPress={() => act('resend', () => resendReferral(env(), r.id))} />
          <View style={st.backup}>
            <View style={st.backupIcon}><Ionicons name="phone-portrait-outline" size={20} color={color.primary} /></View>
            <TextInput value={backup} onChangeText={setBackup} keyboardType="phone-pad" placeholder="Backup number, e.g. 024 123 4567" placeholderTextColor={color.muted}
              accessibilityLabel="Backup number" style={st.backupInput} />
            <Pressable disabled={backup.replace(/\D/g, '').length < 9 || !r.wire || busy === 'backup'} accessibilityRole="button" accessibilityLabel="Send to the backup number"
              onPress={() => act('backup', () => resendReferral(env(), r.id, backup), { title: `Send the referral to ${backup.trim()}?`, body: "The same signed referral SMS goes to that number. Use the facility nurse's own phone.", confirm: 'Send to this number' })}
              style={({ pressed }) => [st.backupSend, (backup.replace(/\D/g, '').length < 9 || !r.wire) && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}>
              <Ionicons name="paper-plane" size={18} color={color.primaryText} />
            </Pressable>
          </View>
          <ActionRow icon="medkit-outline" tone="refer" title="Call an ambulance" detail="112" onPress={() => Linking.openURL('tel:112')} />
        </ActionList>
      )}
    </Screen>
  )
}

const VIA: Record<string, string> = { sms: 'by SMS', https: 'by internet', local: 'on this phone' }
const LEVEL: Record<string, string> = { chps: 'CHPS compound', health_centre: 'Health centre', hospital: 'Hospital', teaching_hospital: 'Teaching hospital' }

const st = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  stepDot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  stepText: { fontSize: 16, lineHeight: 22, color: color.text },
  stepTime: { fontSize: 13, color: color.muted },
  backup: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.lg, borderBottomWidth: 1, borderColor: color.line },
  backupIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primaryBg },
  backupInput: { flex: 1, minHeight: 44, fontSize: 16, color: color.text, borderBottomWidth: 1, borderColor: color.line, paddingVertical: 6 },
  backupSend: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primary },
})
