import { View } from 'react-native'
import { ReferralRow } from '../features/ReferralRow'
import { TabBar } from '../features/TabBar'
import { facilityInbox } from '../lib/register'
import { currentSession, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Empty, Loading, Screen } from '../ui/kit'

export default function Inbox() {
  const { data, error } = useQuery(() => facilityInbox(env()))
  const open = data?.filter((r) => !['closed', 'cancelled'].includes(r.status)).length ?? 0
  return (
    <View style={{ flex: 1 }}>
      <Screen title="Incoming referrals" subtitle={`${currentSession()?.facility.name ?? ''} · ${open} open. Received by SMS, QR or internet.`}>
        {error ? <Banner tone="refer" text={error.message} /> : null}
        {!data ? <Loading /> : data.length === 0 ? <Empty title="No referrals yet" body="Referrals sent to this facility appear here and ring the phone, even when the app is closed." /> : data.map((r) => <ReferralRow key={r.id} r={r} showOrigin />)}
      </Screen>
      <TabBar />
    </View>
  )
}
