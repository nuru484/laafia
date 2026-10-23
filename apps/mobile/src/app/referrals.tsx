import { View } from 'react-native'
import { ReferralList } from '../features/ReferralRow'
import { TabBar } from '../features/TabBar'
import { referralList } from '../lib/register'
import { env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Empty, Loading, Screen } from '../ui/kit'

export default function Referrals() {
  const { data, error } = useQuery(() => referralList(env()))
  return (
    <View style={{ flex: 1 }}>
      <Screen title="Referrals" subtitle="Open referrals first. Each stays here until the facility closes it.">
        {error ? <Banner tone="refer" text={error.message} /> : null}
        {!data ? <Loading /> : data.length === 0 ? <Empty title="No referrals" body="A referral appears here when a checklist ends in refer now." /> : <ReferralList rows={data} />}
      </Screen>
      <TabBar />
    </View>
  )
}
