'use client'

import { useState } from 'react'
import { FilterSelect } from '@/components/shared/filter-select'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/redux/api'
import { useAuditQuery } from '@/redux/endpoints'
import type { AuditEvent } from '@/types/api'

const TYPES = [
  { value: '', label: 'Everything' }, { value: 'user', label: 'Users' }, { value: 'device', label: 'Phones' }, { value: 'facility', label: 'Facilities' },
  { value: 'transport_provider', label: 'Drivers' }, { value: 'transport_request', label: 'Pickups' }, { value: 'referral', label: 'Referrals' },
  { value: 'import_batch', label: 'Imports' }, { value: 'export', label: 'DHIMS2 exports' }, { value: 'clip', label: 'Recordings' }, { value: 'content_pack', label: 'Maps' },
]

/** Older pages are appended as cursors (`before`) so the list never re-orders under the reader. */
export default function AuditPage() {
  const [type, setType] = useState('')
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined])
  return (
    <>
      <PageHeader title="Audit log" description="Every change made on this dashboard: who, what and when." />
      <div className="mb-4 max-w-xs"><FilterSelect label="Show" value={type} onChange={(v) => { setType(v); setCursors([undefined]) }} options={TYPES} /></div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {cursors.map((before, i) => <AuditChunk key={`${type}-${i}`} before={before} type={type} last={i === cursors.length - 1} onMore={(next) => setCursors((c) => [...c, next])} />)}
      </ul>
    </>
  )
}

function AuditChunk({ before, type, last, onMore }: { before?: number; type: string; last: boolean; onMore: (next: number) => void }) {
  const { data, error, isLoading, refetch } = useAuditQuery({ before, target_type: type })
  if (isLoading) return <li className="p-4"><LoadingRows rows={3} /></li>
  if (error) return <li className="p-4"><ErrorState message={errorMessage(error)} onRetry={refetch} /></li>
  if (!data?.events.length && before === undefined) return <li className="p-4"><EmptyState title="Nothing recorded yet" /></li>
  return (
    <>
      {data!.events.map((e) => <Row key={e.id} e={e} />)}
      {last && data!.next_before ? <li className="p-3"><Button variant="outline" className="h-11 w-full" onClick={() => onMore(data!.next_before!)}>Load older</Button></li> : null}
    </>
  )
}

function Row({ e }: { e: AuditEvent }) {
  const detail = Object.entries(e.details ?? {}).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' · ')
  return (
    <li className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="[overflow-wrap:anywhere]"><span className="font-medium">{e.actor_name}</span> {e.action.replace(/[._]/g, ' ')}{e.target_id ? ` · ${e.target_id}` : ''}</p>
        {detail ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
      </div>
      <time className="shrink-0 text-muted-foreground" dateTime={new Date(e.at).toISOString()}>{new Date(e.at).toLocaleString()}</time>
    </li>
  )
}
