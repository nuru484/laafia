import { requireOptionalNativeModule } from 'expo'
import { router } from 'expo-router'
import { useState } from 'react'
import { monthlyReport, reportHtml } from '../lib/report'
import { env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Body, Button, Card, Loading, MonthStepper, Screen, SectionHead, Stats } from '../ui/kit'
import { color } from '../ui/theme'
import { toast } from '../ui/toast'

const monthStart = (back: number) => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) }

/** The month's visits and referrals, printed or saved as a PDF from the phone's print dialog. */
export default function Report() {
  const [back, setBack] = useState(0)
  const { data } = useQuery(() => monthlyReport(env(), monthStart(back)), [back])
  const [printing, setPrinting] = useState(false)

  async function print() {
    if (!data) return
    // A build made before expo-print was added has no native side, and importing it would throw.
    if (!requireOptionalNativeModule('ExpoPrint')) {
      toast('Printing needs the newer Laafia build on this phone. Install it, then print again.', 'error')
      return
    }
    setPrinting(true)
    try {
      // Loaded on use: a build without the print module still opens every other screen.
      const Print = await import('expo-print')
      await Print.printAsync({ html: reportHtml(data) })
    } catch (e) {
      toast(`Could not open printing: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setPrinting(false)
    }
  }

  const t = data?.totals
  return (
    <Screen title="Monthly report" subtitle="Any month: print it, or save it as a PDF to share." onBack={() => router.back()}>
      <MonthStepper back={back} onChange={setBack} />
      {!data || !t ? <Loading /> : (
        <>
          <Card>
            <SectionHead title={data.month} note={data.facilityMode ? 'This facility' : 'Your catchment'} />
            {data.facilityMode ? (
              <Stats items={[{ value: t.referrals, label: 'Referrals received' }, { value: t.referrals_closed, label: 'Discharged' }]} />
            ) : (
              <>
                <Stats columns={3} items={[{ value: t.visits, label: 'Visits' }, { value: t.referrals, label: 'Referrals made' }, { value: t.households, label: 'Households enrolled' }]} />
                <SectionHead title="How the visits ended" />
                <Stats columns={3} items={[
                  { value: t.routine, label: 'Routine', tone: color.routine },
                  { value: t.followup, label: 'Follow-up', tone: color.followup },
                  { value: t.refer, label: 'Referred', tone: color.refer },
                ]} />
                <Body muted>{t.referrals_closed} of the {t.referrals} referrals were discharged.</Body>
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
