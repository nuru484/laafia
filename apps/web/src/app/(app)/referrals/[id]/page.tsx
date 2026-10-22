'use client'

import type { ReferralStatus } from '@laafia/core'
import { ArrowLeft, Phone } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { ErrorState, LoadingRows } from '@/components/shared/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge, UrgencyBadge } from '@/features/referrals/badges'
import { STATUS_LABEL, STATUS_ORDER, TYPE_LABEL, ago, signText } from '@/features/referrals/labels'
import { useLiveReferrals } from '@/features/referrals/use-live'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/redux/api'
import { useFacilitiesQuery, useMeQuery, useOnwardMutation, useReferralClientQuery, useReferralQuery, useRequestTransportMutation, useSetStatusMutation, useTransportOptionsQuery } from '@/redux/endpoints'

const NEXT: Partial<Record<ReferralStatus, { status: 'received' | 'arrived' | 'treated' | 'closed'; label: string }>> = {
  created: { status: 'received', label: 'Acknowledge' },
  carrying: { status: 'received', label: 'Acknowledge' },
  sent: { status: 'received', label: 'Acknowledge' },
  received: { status: 'arrived', label: 'Mark arrived' },
  arrived: { status: 'treated', label: 'Mark treated' },
  treated: { status: 'closed', label: 'Discharge and close' },
}
const TRANSPORT: Record<string, string> = { requested: 'Waiting for reply', coming: 'Coming', declined: 'Cannot come', done: 'Done' }

export default function ReferralDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: me } = useMeQuery()
  const user = me!.user
  const staff = user.role === 'facility_staff'
  const { data, error, isLoading, refetch } = useReferralQuery(id)
  const { data: facs } = useFacilitiesQuery()
  const { data: clientData } = useReferralClientQuery(id, { skip: !staff })
  const [setStatus, statusState] = useSetStatusMutation()
  const [onward, onwardState] = useOnwardMutation()
  const [destination, setDestination] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const { data: transportOptions } = useTransportOptionsQuery(id, { skip: !staff })
  const [requestTransport, transportState] = useRequestTransportMutation()
  useLiveReferrals(staff ? (user.facility?.code ?? null) : null)

  if (isLoading) return <LoadingRows />
  if (error || !data) return <ErrorState message={errorMessage(error)} onRetry={refetch} />
  const r = data.referral
  const names = new Map((facs?.facilities ?? []).map((f) => [f.id, f]))
  const next = NEXT[r.status]
  const atMyFacility = staff && r.destination_facility_id === user.facility_id
  const reached = (s: ReferralStatus) => STATUS_ORDER.indexOf(r.status) >= STATUS_ORDER.indexOf(s)
  const onwardOptions = (facs?.facilities ?? []).filter((f) => f.id !== user.facility_id && f.level !== 'chps')

  async function advance(status: 'received' | 'arrived' | 'treated' | 'closed') {
    try {
      await setStatus({ id, status }).unwrap()
      toast.success(`${STATUS_LABEL[status]}. The CHO is texted.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function sendOnward() {
    try {
      await onward({ id, destination_facility_code: destination }).unwrap()
      toast.success('Referred onward. The facility is texted.')
      setDestination('')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const client = clientData?.client as { name?: string; code?: string; dob?: number | null; delivery_date?: number | null } | null | undefined
  const household = clientData?.household as { head_name?: string; community?: string; landmark?: string } | null | undefined

  return (
    <div className="flex flex-col gap-6">
      <Link href="/referrals" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Referrals</Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <UrgencyBadge urgency={r.urgency} />
          <StatusBadge status={r.status} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{TYPE_LABEL[r.client_type ?? ''] ?? 'Client'} {r.client_code}</h1>
        <p className="text-sm text-muted-foreground">Referral {r.short_id} · context {r.context ?? '-'} · from phone {r.origin_device_id} · to {names.get(r.destination_facility_id ?? '')?.name ?? 'unknown facility'}</p>
      </div>

      {atMyFacility && next ? (
        <Card className="border-primary/40">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">Next step at {user.facility?.name}.</p>
            <Button className="h-11" disabled={statusState.isLoading} onClick={() => (next.status === 'closed' ? setConfirmClose(true) : advance(next.status))}>{next.label}</Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 @3xl/main:grid-cols-2">
        <Card>
          <CardHeader><CardTitle><h2>Danger signs</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {r.danger_signs.length ? r.danger_signs.map((s) => <p key={s} className="rounded-md bg-refer-tint px-3 py-2 text-sm font-medium text-refer">{signText(s)}</p>) : <p className="text-sm text-muted-foreground">None recorded.</p>}
            <p className="text-xs text-muted-foreground">From the WHO checklist on the CHO's phone. An assessment, not a diagnosis.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle><h2>Progress</h2></CardTitle></CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {STATUS_ORDER.filter((s) => s !== 'carrying' || r.events.some((e) => e.status === 'carrying')).map((s) => {
                const ev = r.events.find((e) => e.status === s)
                return (
                  <li key={s} className="flex items-center gap-3">
                    <span className={cn('size-3 shrink-0 rounded-full', reached(s) ? 'bg-routine' : 'bg-border')} aria-hidden />
                    <span className={cn('flex-1 text-sm', !reached(s) && 'text-muted-foreground')}>{s === 'created' ? 'Created on the phone' : s === 'sent' ? 'Sent' : STATUS_LABEL[s]}</span>
                    {ev ? <span className="text-xs text-muted-foreground">{ago(ev.at)} · {ev.via}</span> : null}
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>

        {staff && client ? (
          <Card>
            <CardHeader><CardTitle><h2>Client</h2></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <p className="font-medium [overflow-wrap:anywhere]">{client.name}</p>
              {household ? <p className="text-muted-foreground [overflow-wrap:anywhere]">{household.landmark || household.community}{household.head_name ? `, household of ${household.head_name}` : ''}</p> : null}
              {r.next_of_kin ? <a href={`tel:${r.next_of_kin}`} className="inline-flex min-h-11 items-center gap-2 text-primary"><Phone className="size-4" aria-hidden /> Next of kin {r.next_of_kin}</a> : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader><CardTitle><h2>Transport</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {staff && atMyFacility && !reached('arrived') && transportOptions?.providers.length ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">Drivers near {transportOptions.community ?? 'the client'}. The driver is texted the pickup and replies 1 or 2.</p>
                {transportOptions.providers.filter((p) => p.active && !r.transport.some((t) => t.provider_id === p.id && (t.status === 'requested' || t.status === 'coming'))).map((p) => (
                  <Button key={p.id} variant="outline" className="h-11 justify-start" disabled={transportState.isLoading}
                    onClick={() => requestTransport({ id, provider_id: p.id }).unwrap().then(() => toast.success(`${p.name} is texted.`), (e) => toast.error(errorMessage(e)))}>
                    Text {p.name} ({p.vehicle || 'driver'}, {p.community})
                  </Button>
                ))}
              </div>
            ) : null}
            {r.transport.length === 0 ? <p className="text-muted-foreground">No driver requested.</p> : r.transport.map((t) => (
              <div key={t.id} className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="[overflow-wrap:anywhere]">{t.provider_name ?? 'Driver'}: {TRANSPORT[t.status] ?? t.status}</span>
                {t.provider_phone ? <a href={`tel:${t.provider_phone}`} className="inline-flex min-h-11 items-center gap-2 text-primary"><Phone className="size-4" aria-hidden /> {t.provider_phone}</a> : null}
              </div>
            ))}
          </CardContent>
        </Card>

        {(r.parent_referral_id || r.onward_referral_id || (data.chain?.length ?? 0) > 1) ? (
          <Card>
            <CardHeader><CardTitle><h2>Referral chain</h2></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {r.parent_referral_id ? <Link className="text-primary underline-offset-4 hover:underline" href={`/referrals/${r.parent_referral_id}`}>Came from an earlier referral</Link> : null}
              {r.onward_referral_id ? <Link className="text-primary underline-offset-4 hover:underline" href={`/referrals/${r.onward_referral_id}`}>Referred onward{r.onward_status ? `: ${STATUS_LABEL[r.onward_status]}` : ''}</Link> : null}
            </CardContent>
          </Card>
        ) : null}

        {atMyFacility && !reached('closed') && !r.onward_referral_id ? (
          <Card>
            <CardHeader><CardTitle><h2>Refer onward</h2></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <FilterSelect label="Destination" value={destination} onChange={setDestination}
                options={[{ value: '', label: 'Choose a facility' }, ...onwardOptions.map((f) => ({ value: f.code, label: f.name }))]} />
              <Button className="h-11" variant="destructive" disabled={!destination || onwardState.isLoading} onClick={sendOnward}>Refer onward</Button>
              <p className="text-xs text-muted-foreground">Sends the same assessment to the next facility; the CHO keeps seeing the progress.</p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discharge and close this referral?</AlertDialogTitle>
            <AlertDialogDescription>The CHO is texted, and the client returns to her visit list for a follow-up in 3 days.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmClose(false); void advance('closed') }}>Discharge</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
