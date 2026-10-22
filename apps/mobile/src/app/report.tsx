import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { Choice } from '../features/Choice'
import { monthlyReport, reportHtml } from '../lib/report'
import { env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Body, Button, Card, Label, Loading, Screen } from '../ui/kit'
import { space } from '../ui/theme'

const monthStart = (back: number) => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) }

/** The month's visits and referrals, printed or saved as a PDF from the phone's print dialog. */
export default function Report() {
  const [back, setBack] = useState(0)
  const { data } = useQuery(() => monthlyReport(env(), monthStart(back)), [back])
  const [printing, setPrinting] = useState(false)

  async function print() {
    if (!data) return
    setPrinting(true)
    try {
      // Loaded on use: a build without the print module still opens every other screen.
      const Print = await import('expo-print')
      await Print.printAsync({ html: reportHtml(data) })
    } catch (e) {
      Alert.alert('Could not open printing', e instanceof Error ? e.message : String(e))
    } finally {
      setPrinting(false)
    }
  }

  const t = data?.totals
  return (
    <Screen title="Monthly report" subtitle="Print it, or save it as a PDF to share." right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup">
        <Choice role="radio" label="This month" on={back === 0} onPress={() => setBack(0)} />
        <Choice role="radio" label="Last month" on={back === 1} onPress={() => setBack(1)} />
      </View>
      {!data || !t ? <Loading /> : (
        <>
          <Card>
            <Label>{data.month}</Label>
            {data.facilityMode ? (
              <Body>{t.referrals} referrals received · {t.referrals_closed} discharged</Body>
            ) : (
              <>
                <Body>{t.visits} visits: {t.routine} routine, {t.followup} follow up, {t.refer} referred</Body>
                <Body>{t.referrals} referrals made · {t.referrals_closed} discharged</Body>
                <Body>{t.households} households enrolled</Body>
              </>
            )}
          </Card>
          <Button label="Print or save as PDF" busy={printing} onPress={print} />
          <Body muted>The page lists every {data.facilityMode ? 'referral received' : 'visit and referral'} with its date, client code and outcome.</Body>
        </>
      )}
    </Screen>
  )
}
