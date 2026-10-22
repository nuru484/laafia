'use client'

import type { ReferralStatus } from '@laafia/core'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { FilterSelect } from '@/components/shared/filter-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge, UrgencyBadge } from '@/features/referrals/badges'
import { OPEN, STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, ago, signText } from '@/features/referrals/labels'
import { useLiveReferrals } from '@/features/referrals/use-live'
import { errorMessage } from '@/redux/api'
import { useFacilitiesQuery, useMeQuery, useReferralsQuery } from '@/redux/endpoints'
import type { Referral } from '@/types/api'

const ALL = 'all'

export default function ReferralsPage() {
  const { data: me } = useMeQuery()
  const user = me!.user
  const staff = user.role === 'facility_staff'
  const [facility, setFacility] = useState<string>(staff ? (user.facility?.code ?? ALL) : ALL)
  const [status, setStatus] = useState<string>('open')
  const [urgency, setUrgency] = useState<string>(ALL)

  const { data: facs } = useFacilitiesQuery()
  const live = staff ? (user.facility?.code ?? null) : facility !== ALL ? facility : null
  useLiveReferrals(live)
  // District views without a single facility have no SSE stream; refresh them on a timer instead.
  const { data, error, isLoading, refetch } = useReferralsQuery(
    { facility: facility === ALL ? undefined : facility, urgency: urgency === ALL ? undefined : urgency },
    { pollingInterval: live ? 0 : 15_000 },
  )

  const names = useMemo(() => new Map((facs?.facilities ?? []).map((f) => [f.id, f.name])), [facs])
  const rows = useMemo(() => {
    const list = (data?.referrals ?? []).filter((r) => (status === ALL ? true : status === 'open' ? OPEN.includes(r.status) : r.status === status))
    return [...list].sort((a, b) => Number(!OPEN.includes(a.status)) - Number(!OPEN.includes(b.status)) || (b.urgency ?? 0) - (a.urgency ?? 0) || b.updated_at - a.updated_at)
  }, [data, status])

  return (
    <>
      <PageHeader
        title={staff ? 'Incoming referrals' : 'Referrals'}
        description={staff ? `${user.facility?.name}. New referrals appear here as they arrive, by SMS, QR or internet.` : 'Every referral in the district, most urgent first. Open a referral for its timeline and transport.'}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {!staff ? (
          <FilterSelect label="Facility" value={facility} onChange={setFacility}
            options={[{ value: ALL, label: 'All facilities' }, ...(facs?.facilities ?? []).map((f) => ({ value: f.code, label: f.name }))]} />
        ) : null}
        <FilterSelect label="Status" value={status} onChange={setStatus}
          options={[{ value: 'open', label: 'Open' }, { value: ALL, label: 'All states' }, ...[...STATUS_ORDER, 'cancelled' as ReferralStatus].map((st) => ({ value: st, label: STATUS_LABEL[st] }))]} />
        <FilterSelect label="Urgency" value={urgency} onChange={setUrgency}
          options={[{ value: ALL, label: 'Any urgency' }, { value: '3', label: 'Emergency' }, { value: '2', label: 'Urgent' }, { value: '1', label: 'Routine' }]} />
      </div>

      {isLoading ? <LoadingRows /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : rows.length === 0 ? (
        <EmptyState title="No referrals here" body={status === 'open' ? 'Nothing open right now. Closed referrals are under All states.' : 'Try another filter.'} />
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => <ReferralCard key={r.id} r={r} names={names} showDestination={!staff} />)}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="w-[40%]">Danger signs</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                  {!staff ? <TableHead>To</TableHead> : null}
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className="relative">
                    <TableCell className="font-medium">
                      <Link href={`/referrals/${r.id}`} className="after:absolute after:inset-0 focus-visible:underline">{TYPE_LABEL[r.client_type ?? ''] ?? 'Client'} {r.client_code}</Link>
                    </TableCell>
                    <TableCell className="max-w-0"><span className="line-clamp-1 whitespace-normal [overflow-wrap:anywhere]" title={r.danger_signs.map(signText).join(', ')}>{r.danger_signs.map(signText).join(', ')}</span></TableCell>
                    <TableCell><UrgencyBadge urgency={r.urgency} /></TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    {!staff ? <TableCell className="text-muted-foreground">{names.get(r.destination_facility_id ?? '') ?? 'Unknown'}</TableCell> : null}
                    <TableCell className="text-right text-muted-foreground">{ago(r.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  )
}

function ReferralCard({ r, names, showDestination }: { r: Referral; names: Map<string, string>; showDestination: boolean }) {
  return (
    <li>
      <Link href={`/referrals/${r.id}`} className="flex flex-col gap-2 rounded-lg border bg-card p-4 focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{TYPE_LABEL[r.client_type ?? ''] ?? 'Client'} {r.client_code}</p>
          <UrgencyBadge urgency={r.urgency} />
        </div>
        <p className="text-sm [overflow-wrap:anywhere]">{r.danger_signs.map(signText).join(', ')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={r.status} />
          <span className="text-xs text-muted-foreground">{showDestination ? `to ${names.get(r.destination_facility_id ?? '') ?? 'unknown facility'} · ` : ''}{ago(r.updated_at)}</span>
        </div>
      </Link>
    </li>
  )
}
