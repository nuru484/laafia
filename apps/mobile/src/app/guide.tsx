import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { currentSession } from '../lib/runtime'
import type { IconName } from '../ui/kit'
import { Screen } from '../ui/kit'
import { Text } from '../ui/text'
import { color, font, space } from '../ui/theme'

type Section = { icon: IconName; title: string; steps: string[] }

const CHO: Section[] = [
  { icon: 'calendar-clear-outline', title: 'Your day: the Today list', steps: [
    'Today lists who to visit, most urgent first, then a walking route. Open referrals, newborns and anyone booked or due today are always on it.',
    'Hold a row and drag it to change the order. Tap a row to open the client.',
    'After a visit she moves to Visited today with how it ended. Add more visits for today brings in the next clients by risk.',
  ] },
  { icon: 'clipboard-outline', title: 'A visit', steps: [
    'Open the client and tap Start visit checklist. Answer each question; the next one depends on the answers so far.',
    'If a danger sign appears, Refer now, finish checklist later sends the referral at once.',
    'At the end you see the outcome and what to tell the family. Save the visit, or send the referral.',
  ] },
  { icon: 'paper-plane-outline', title: 'Referring', steps: [
    'Choose the facility: the suggested one is the nearest that can treat the signs. Send referral texts it to the facility phone.',
    'Write the slip code from the referral screen on her referral note. If the SMS does not arrive, the facility types it in.',
    'No acknowledgement? From the referral: call the facility, resend the SMS, send to a backup number, or call 112.',
  ] },
  { icon: 'person-add-outline', title: 'Enrolling', steps: [
    'Tap Enrol on Today or Clients. Tick consent first: nothing else opens until you do.',
    'Choose an existing household by searching, or add a new one. If she may already be registered, the app shows her: open her record instead of enrolling twice.',
    'The house position is optional. Capture it at the house, from her client page, on the first home visit.',
  ] },
  { icon: 'heart-outline', title: 'After a birth', steps: [
    'Open the mother and tap Record the delivery. Choose the day, born alive or stillbirth, and each baby.',
    'She moves to after-delivery care and each baby is added as a newborn, at the top of Today for a visit within 48 hours.',
  ] },
  { icon: 'chatbubble-ellipses-outline', title: 'Bookings by text', steps: [
    'A client texts your phone to ask for a visit. Booking requests show on Today; choose the day and she is texted the date and a reminder.',
    'You can also book from her client page with the calendar.',
  ] },
  { icon: 'cloud-done-outline', title: 'Without internet', steps: [
    'Everything works offline and is saved on this phone. Referrals and texts go by SMS.',
    'Records upload when there is internet. Pull down on any screen to sync now.',
  ] },
  { icon: 'shield-checkmark-outline', title: 'Your phone and its data', steps: [
    'More, Phone setup checks: allow SMS, notifications and location, and stop the battery saver from closing Laafia.',
    'The PIN, or your fingerprint or face, opens the app. Lock now from More when you put the phone down.',
    'Sign out of this phone removes the register after everything has uploaded. A new code from the district brings it back.',
  ] },
]

const FACILITY: Section[] = [
  { icon: 'notifications-outline', title: 'Incoming referrals', steps: [
    'A referral SMS rings the phone, even with the app closed. An emergency keeps ringing until you open it.',
    'Open it to see the danger signs, who sent it and when. Laafia texts the CHO that it was received.',
  ] },
  { icon: 'checkmark-done-outline', title: 'When she comes', steps: [
    'On the referral, tap She has arrived, then Treated, then Discharged. Each step asks first, then texts the CHO.',
    'Discharged closes the referral and puts a follow-up home visit on the CHO\'s Today list.',
  ] },
  { icon: 'keypad-outline', title: 'She came with a slip code', steps: [
    'If no SMS arrived, tap Slip code on Incoming referrals and type the code from her referral note. The same referral opens.',
  ] },
  { icon: 'arrow-redo-outline', title: 'Referring on', steps: [
    'If she needs a higher level, open the referral and choose Refer to under Refer onward. The CHO keeps seeing the progress.',
  ] },
  { icon: 'search-outline', title: 'Finding a client', steps: [
    'More, Look up a client: search by the code on the referral or by name.',
  ] },
  { icon: 'battery-charging-outline', title: 'Keep the phone listening', steps: [
    'Keep it charged and switched on, with a SIM that has credit.',
    'More, Phone setup checks: allow notifications and the alarm over the lock screen, and stop the battery saver from closing Laafia.',
  ] },
]

/** How to use Laafia, for the phone's own role. */
export default function Guide() {
  const facility = currentSession()?.role === 'facility'
  const sections = facility ? FACILITY : CHO
  return (
    <Screen title="How to use Laafia" subtitle={facility ? 'For the facility phone' : 'For the community health officer'} onBack={() => router.back()}>
      {sections.map((sec) => (
        <View key={sec.title} style={st.section}>
          <View style={st.head}>
            <View style={st.icon}><Ionicons name={sec.icon} size={20} color={color.primary} /></View>
            <Text style={st.title} accessibilityRole="header">{sec.title}</Text>
          </View>
          {sec.steps.map((step, i) => (
            <View key={i} style={st.step}>
              <Text style={st.num}>{i + 1}</Text>
              <Text style={st.text}>{step}</Text>
            </View>
          ))}
        </View>
      ))}
    </Screen>
  )
}

const st = StyleSheet.create({
  section: { gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderColor: color.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: color.primaryBg },
  title: { flex: 1, fontSize: font.body + 1, fontWeight: '700', color: color.text },
  step: { flexDirection: 'row', gap: space.md, paddingLeft: 4 },
  num: { width: 18, fontSize: 15, lineHeight: 22, fontWeight: '700', color: color.muted, fontVariant: ['tabular-nums'] },
  text: { flex: 1, fontSize: 15, lineHeight: 22, color: color.text },
})
