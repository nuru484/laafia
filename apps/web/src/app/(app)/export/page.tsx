'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorCode, errorMessage } from '@/redux/api'
import { useExportHistoryQuery, useExportPreviewQuery, useExportPushMutation, useFacilitiesQuery } from '@/redux/endpoints'
import type { ExportPreview, ExportResult } from '@/types/api'

function lastMonths(n: number): { value: string; label: string }[] {
  const now = new Date()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return { value: `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
  })
}

/** Monthly figures in the order the DHIS2 mapping lists its data elements, used when the API sends no summary. */
const FIGURE_ORDER = ['ANC contacts', 'Postnatal visits within 48 hours', 'Referrals made', 'Referrals completed']

function figures(p: ExportPreview): { label: string; value: number }[] {
  if (p.summary) {
    return [
      { label: 'People with activity', value: p.summary.tracked_entities },
      { label: 'ANC contacts', value: p.summary.anc_contacts },
      { label: 'Postnatal visits within 48 hours', value: p.summary.pnc_within_48h },
      { label: 'Referrals made', value: p.summary.referrals_made },
      { label: 'Referrals completed', value: p.summary.referrals_completed },
    ]
  }
  return [{ label: 'People with activity', value: p.tracker.trackedEntities.length }, ...p.dataValueSet.dataValues.map((d, i) => ({ label: FIGURE_ORDER[i] ?? d.dataElement, value: Number(d.value) }))]
}

export default function ExportPage() {
  const { data: facs } = useFacilitiesQuery()
  const months = lastMonths(6)
  const [facility, setFacility] = useState('')
  const [period, setPeriod] = useState(months[0]!.value)
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const ready = !!facility
  const preview = useExportPreviewQuery({ facility, period }, { skip: !ready })
  const history = useExportHistoryQuery(facility, { skip: !ready })
  const [push, pushState] = useExportPushMutation()
  const periodLabel = months.find((m) => m.value === period)?.label

  async function send(dryRun: boolean) {
    setConfirm(false)
    try {
      const r = await push({ facility, period, dry_run: dryRun }).unwrap()
      setResult(r)
      toast.success(dryRun ? 'DHIMS2 checked the data and saved nothing.' : `Sent to DHIMS2: ${r.tracker.stats.created + r.tracker.stats.updated} tracker records, ${r.aggregate.import_count.imported + r.aggregate.import_count.updated} monthly values.`)
    } catch (e) {
      toast.error(errorCode(e) === 'dhis2_unconfigured' ? 'DHIMS2 is not connected on this server yet.' : errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="DHIMS2 export" description="Send a compound's month to DHIMS2: each person with a visit or referral, and the monthly totals of the CHPS form. Nobody re-tallies the register." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <FilterSelect label="Facility" value={facility} onChange={setFacility} options={[{ value: '', label: 'Choose a facility' }, ...(facs?.facilities ?? []).map((f) => ({ value: f.code, label: f.name }))]} />
        <FilterSelect label="Month" value={period} onChange={setPeriod} options={months} />
      </div>

      {!ready ? null : preview.isLoading ? <LoadingRows rows={2} /> : preview.error ? <ErrorState message={errorMessage(preview.error)} onRetry={preview.refetch} /> : preview.data ? (
        <div className="grid gap-6 @3xl/main:grid-cols-2">
          <Card>
            <CardHeader><CardTitle><h2>{periodLabel}</h2></CardTitle><CardDescription>What will be sent. Built from the visits and referrals recorded on phones.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                {figures(preview.data).map((f) => (<div key={f.label} className="contents"><dt className="text-muted-foreground">{f.label}</dt><dd className="text-right font-medium tabular-nums">{f.value}</dd></div>))}
              </dl>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="h-11" disabled={pushState.isLoading} onClick={() => send(true)}>Check with DHIMS2</Button>
                <Button className="h-11" disabled={pushState.isLoading} onClick={() => setConfirm(true)}>Send to DHIMS2</Button>
              </div>
              <p className="text-xs text-muted-foreground">Check sends the data with DHIMS2's dry run, so it validates everything and saves nothing. Sending again later updates the same records rather than duplicating them.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle><h2>Exports</h2></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {result ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium">{result.dry_run ? 'Last check' : 'Last send'}: tracker {result.tracker.status}, totals {result.aggregate.status}</p>
                  <p className="text-muted-foreground">{result.tracker.stats.created} created · {result.tracker.stats.updated} updated · {result.tracker.stats.ignored} ignored{result.tracker.errors.length ? ` · ${result.tracker.errors.length} errors` : ''}</p>
                </div>
              ) : null}
              {history.data ? (
                <>
                  {history.data.pending_periods.length ? <p>Not yet sent: {history.data.pending_periods.map((p) => months.find((m) => m.value === p)?.label ?? p).join(', ')}</p> : <p className="text-muted-foreground">Every month with activity has been sent.</p>}
                  <ul className="flex flex-col gap-2">
                    {history.data.runs.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                        <span>{months.find((m) => m.value === x.period)?.label ?? x.period} · {new Date(x.at).toLocaleString()}{x.actor ? ` · ${x.actor}` : ''}</span>
                        <Badge variant={x.status === 'error' ? 'destructive' : x.dry_run ? 'secondary' : 'default'}>{x.dry_run ? 'Check' : 'Sent'}{x.status === 'error' ? ', failed' : ''}</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              ) : history.isLoading ? <LoadingRows rows={2} /> : <ErrorState message={`Could not load the export history. ${errorMessage(history.error)}`} onRetry={history.refetch} />}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {periodLabel} to DHIMS2?</AlertDialogTitle>
            <AlertDialogDescription>This writes to the district's DHIMS2. Run the check first if you have not.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => send(false)}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
