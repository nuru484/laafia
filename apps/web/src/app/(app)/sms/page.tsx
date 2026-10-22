'use client'

import { useState } from 'react'
import { ErrorState, EmptyState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/redux/api'
import { useSmsBalanceQuery, useSmsLogQuery } from '@/redux/endpoints'

const KIND: Record<string, string> = { ack: 'Acknowledgement to CHO', status: 'Status to CHO', driver: 'Driver pickup', referral: 'Referral to facility' }
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { delivered: 'default', sent: 'secondary', queued: 'outline', failed: 'destructive' }

export default function SmsPage() {
  const balance = useSmsBalanceQuery()
  const [before, setBefore] = useState<number | undefined>(undefined)
  const log = useSmsLogQuery({ before })

  return (
    <>
      <PageHeader title="SMS gateway" description="Texts the server sends through Frog when a phone cannot: web acknowledgements, status updates and driver pickups. Phones text each other directly from their own SIMs." />
      <Card className="mb-6">
        <CardHeader><CardTitle><h2>Frog balance</h2></CardTitle><CardDescription>Top up before it runs low; without credit the server cannot text CHOs or drivers.</CardDescription></CardHeader>
        <CardContent>
          {balance.isLoading ? <LoadingRows rows={1} /> : balance.error ? <ErrorState message={errorMessage(balance.error)} onRetry={balance.refetch} /> : !balance.data?.configured ? (
            <p className="text-sm text-muted-foreground">Frog is not connected on this server, so texts are logged instead of sent.</p>
          ) : <p className="text-3xl font-semibold tabular-nums">{balance.data.balance ?? '-'} <span className="text-base font-normal text-muted-foreground">{balance.data.currency ?? 'credits'}</span></p>}
        </CardContent>
      </Card>
      <h2 className="mb-3 text-lg font-semibold">Recent texts</h2>
      {log.isLoading ? <LoadingRows /> : log.error ? <ErrorState message={errorMessage(log.error)} onRetry={log.refetch} /> : !log.data?.messages.length ? <EmptyState title="No texts sent yet" /> : (
        <>
          <ul className="flex flex-col divide-y rounded-lg border">
            {log.data.messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{KIND[m.kind] ?? m.kind} · {m.to_masked}</p>
                  <p className="text-muted-foreground">{new Date(m.at).toLocaleString()}{m.attempts > 1 ? ` · ${m.attempts} attempts` : ''}{m.error ? ` · ${m.error}` : ''}</p>
                </div>
                <Badge variant={STATUS_VARIANT[m.status] ?? 'outline'} className="w-fit capitalize">{m.status}</Badge>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            {before ? <Button variant="outline" className="h-11" onClick={() => setBefore(undefined)}>Newest</Button> : null}
            {log.data.next_before ? <Button variant="outline" className="h-11" onClick={() => setBefore(log.data!.next_before!)}>Older</Button> : null}
          </div>
        </>
      )}
    </>
  )
}
