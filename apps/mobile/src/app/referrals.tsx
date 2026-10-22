import { View } from 'react-native'
import { ReferralRow } from '../features/ReferralRow'
import { TabBar } from '../features/TabBar'
import { referralList } from '../lib/register'
import { currentSession, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Empty, Loading, Screen } from '../ui/kit'

export default function Referrals() {
  const { data, error } = useQuery(() => referralList(env()))
  const carrying = currentSession()?.role === 'volunteer'
  return (
    <View style={{ flex: 1 }}>
      <Screen title={carrying ? 'Carrying' : 'Referrals'} subtitle="Open referrals first. Each stays here until the facility closes it.">
        {error ? <Banner tone="refer" text={error.message} /> : null}
        {!data ? <Loading /> : data.length === 0 ? <Empty title="No referrals" body={carrying ? 'Scan a referral QR from the More tab to carry it.' : 'A referral appears here when a checklist ends in refer now.'} /> : data.map((r) => <ReferralRow key={r.id} r={r} />)}
      </Screen>
      <TabBar />
    </View>
  )
}
