'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FilterSelect } from '@/components/shared/filter-select'
import { ErrorState, PageHeader } from '@/components/shared/page'
import { OverviewSkeleton } from '@/components/shared/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DailyColumns, LabelledBars } from '@/features/overview/charts'
import { STATUS_LABEL, STATUS_ORDER } from '@/features/referrals/labels'
import { errorMessage } from '@/redux/api'
import Link from 'next/link'
import { ago } from '@/features/referrals/labels'
import { useMeQuery, useOverviewQuery, useSummaryQuery } from '@/redux/endpoints'
import type { Brief } from '@/types/api'

const pct = (v: number | null) => (v === null ? '-' : `${Math.round(v * 100)}%`)
const mins = (v: number | null) => (v === null ? '-' : v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`)

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  )
}

export default function Overview() {
  const { data: me } = useMeQuery()
  const router = useRouter()
  const staff = me?.user.role === 'facility_staff'
  const [days, setDays] = useState('30')
  const { data, error, isLoading, refetch } = useSummaryQuery(Number(days), { skip: staff, pollingInterval: 60_000 })
  const { data: attention } = useOverviewQuery(undefined, { skip: staff, pollingInterval: 60_000 })

  useEffect(() => {
    if (staff) router.replace('/referrals')
  }, [staff, router])

  if (staff || isLoading) return <OverviewSkeleton />
  if (error || !data) return <ErrorState message={errorMessage(error)} onRetry={refetch} />
  const open = STATUS_ORDER.filter((s) => !['closed'].includes(s)).reduce((n, s) => n + (data.by_status[s] ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${data.district.name} district. Referrals made by CHOs and how quickly facilities answered and finished them.`}
        actions={<div className="w-44"><FilterSelect label="Period" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }]} /></div>}
      />
      <div className="grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 @4xl/main:grid-cols-4">
        <Tile label="Referrals" value={String(data.total)} note={`${open} still open`} />
        <Tile label="Median time to acknowledge" value={mins(data.time_to_ack_minutes.median)} note={`90% within ${mins(data.time_to_ack_minutes.p90)}`} />
        <Tile label="Completed" value={pct(data.completion_rate)} note="Treated or closed" />
        <Tile label="Not acknowledged" value={String(data.by_status.sent ?? 0)} note="Sent, no facility reply yet" />
      </div>
      {attention ? (
        <div className="mt-6 grid gap-6 @4xl/main:grid-cols-3">
          <Attention title="No acknowledgement" empty="Every referral was acknowledged in time." items={attention.overdue_acknowledgements} note="Call the facility; the CHO's phone is already prompting a resend." />
          <Attention title="Did not arrive" empty="Everyone acknowledged has arrived." items={attention.did_not_arrive} note="The CHO is asked to visit the house." />
          <Card>
            <CardHeader><CardTitle><h2>Nurses' phones not synced in 3 days</h2></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {attention.devices_not_synced_3d.length === 0 ? <p className="text-muted-foreground">Every phone has synced recently.</p> : attention.devices_not_synced_3d.map((d) => (
                <p key={d.id} className="[overflow-wrap:anywhere]"><span className="font-medium">{d.user_name}</span> <span className="text-muted-foreground">· {d.last_sync_at ? `last synced ${ago(d.last_sync_at)}` : 'never synced'}</span></p>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
      <div className="mt-6 grid gap-6 @4xl/main:grid-cols-2">
        <Card>
          <CardHeader><CardTitle><h2>Referrals per day</h2></CardTitle></CardHeader>
          <CardContent><DailyColumns title="Referrals per day" data={data.daily.map((d) => ({ day: d.day, value: d.referrals }))} label="referrals" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle><h2>Where referrals are now</h2></CardTitle></CardHeader>
          <CardContent><LabelledBars rows={[...STATUS_ORDER, 'cancelled' as const].map((s) => ({ label: STATUS_LABEL[s], value: data.by_status[s] ?? 0 }))} /></CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle><h2>By facility</h2></CardTitle></CardHeader>
        <CardContent>
          <ul className="flex flex-col md:hidden">
            {data.per_facility.map((f) => (
              <li key={f.facility.id} className="border-b py-3 text-sm first:pt-0 last:border-b-0 last:pb-0">
                <p className="font-medium [overflow-wrap:anywhere]">{f.facility.name}</p>
                <p className="text-muted-foreground">Sent {f.referred_from} · received {f.received} · open {f.open}</p>
                <p className="text-muted-foreground">{f.received ? `Acknowledged in ${mins(f.median_ack_minutes)} · completed ${pct(f.completion_rate)}` : 'Receives no referrals'}</p>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead>
                  <TableHead className="text-right">Sent from</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Median acknowledge</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.per_facility.map((f) => (
                  <TableRow key={f.facility.id}>
                    <TableCell className="font-medium">{f.facility.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.referred_from}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.received}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.open}</TableCell>
                    <TableCell className="text-right tabular-nums">{mins(f.median_ack_minutes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(f.completion_rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function Attention({ title, empty, items, note }: { title: string; empty: string; items: Brief[]; note: string }) {
  return (
    <Card className={items.length ? 'border-refer/40' : undefined}>
      <CardHeader><CardTitle><h2>{title}{items.length ? ` (${items.length})` : ''}</h2></CardTitle></CardHeader>
      <CardContent className="flex flex-col text-sm">
        {items.length === 0 ? <p className="text-muted-foreground">{empty}</p> : (
          <>
            {items.map((r) => (
              <Link key={r.id} href={`/referrals/${r.id}`} className="-mx-2 flex min-h-11 items-center justify-between gap-2 border-b px-2 last-of-type:border-b-0 hover:bg-muted">
                <span className="[overflow-wrap:anywhere]">{r.client_code} · urgency {r.urgency}</span>
                <span className="shrink-0 text-muted-foreground">{ago(r.made_at)}</span>
              </Link>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">{note}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
