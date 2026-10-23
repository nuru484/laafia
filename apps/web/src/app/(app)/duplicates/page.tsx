'use client'

import { toast } from 'sonner'
import { useConfirm } from '@/components/shared/confirm'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/page'
import { LogSkeleton } from '@/components/shared/skeletons'
import { Button } from '@/components/ui/button'
import { TYPE_LABEL, ago } from '@/features/referrals/labels'
import { errorMessage } from '@/redux/api'
import { useDevicesQuery, useDuplicatesQuery, useMergeClientMutation } from '@/redux/endpoints'
import type { DuplicateClient, DuplicateGroup } from '@/types/api'

const TYPE: Record<string, string> = { pregnant: 'Pregnant', postpartum: 'After delivery', newborn: 'Newborn', child: 'Child' }

/**
 * Clients two phones may have enrolled twice. Keeping one folds the others into it: their visits and referrals
 * move across and the phones get the change on their next sync.
 */
export default function DuplicatesPage() {
  const { data, error, isLoading, refetch } = useDuplicatesQuery()
  const { data: devices } = useDevicesQuery()
  const [merge, { isLoading: merging }] = useMergeClientMutation()
  const [confirm, confirmDialog] = useConfirm()
  const nurse = new Map((devices?.devices ?? []).map((d) => [d.id, d.user_name]))

  async function keep(group: DuplicateGroup, kept: DuplicateClient) {
    const others = group.clients.filter((c) => c.id !== kept.id)
    const ok = await confirm({
      title: `Keep ${kept.name} (${kept.code})?`,
      body: `${others.map((o) => `${o.name} (${o.code})`).join(' and ')} ${others.length === 1 ? 'is' : 'are'} merged into it: visits and referrals move across and the duplicate is removed from every phone. This cannot be undone.`,
      confirm: 'Merge', destructive: true,
    })
    if (!ok) return
    try {
      for (const o of others) await merge({ id: o.id, into: kept.id }).unwrap()
      toast.success(`Merged into ${kept.name}. The phones update on their next sync.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="Possible duplicates" description="Clients who may have been enrolled twice, on different phones: the same phone number, or the same name and type in one community. Check with the nurses, then keep one record." />
      {isLoading ? <LogSkeleton lines={[['w-32'], ['w-full'], ['w-full']]} rows={3} /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !data?.groups.length ? (
        <EmptyState title="No possible duplicates" body="Every client in the district looks like a different person." />
      ) : (
        <ul className="flex flex-col gap-4">
          {data.groups.map((g) => (
            <li key={g.clients.map((c) => c.id).join('|')} className="-mx-4 border-y bg-card sm:mx-0 sm:rounded-lg sm:border">
              <p className="border-b px-4 py-2.5 text-sm text-muted-foreground sm:px-5">
                <span className="font-medium text-foreground">{g.reason === 'same phone' ? 'Same phone number' : 'Same name, type and community'}</span> · {g.clients.length} records
              </p>
              <div className="grid divide-y @2xl/main:grid-cols-2 @2xl/main:divide-x @2xl/main:divide-y-0">
                {g.clients.map((c) => (
                  <div key={c.id} className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-5">
                    <div className="min-w-0">
                      <p className="font-semibold [overflow-wrap:anywhere]">{c.name}</p>
                      <p className="text-sm text-muted-foreground">{TYPE[c.type] ?? TYPE_LABEL[c.type] ?? c.type} · {c.code}</p>
                    </div>
                    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted-foreground">Community</dt><dd className="[overflow-wrap:anywhere]">{c.community || '-'}</dd>
                      <dt className="text-muted-foreground">Household</dt><dd className="[overflow-wrap:anywhere]">{c.head_name || '-'}</dd>
                      <dt className="text-muted-foreground">Phone</dt><dd>{c.phone ?? 'None'}</dd>
                      <dt className="text-muted-foreground">Enrolled by</dt><dd className="[overflow-wrap:anywhere]">{c.device_id ? nurse.get(c.device_id) ?? c.device_id : '-'}</dd>
                      <dt className="text-muted-foreground">Records</dt><dd>{c.visits} visits · {c.referrals} referrals</dd>
                      <dt className="text-muted-foreground">Last change</dt><dd>{ago(c.updated_at)}</dd>
                    </dl>
                    <Button variant="outline" className="h-10 self-start" disabled={merging} onClick={() => void keep(g, c)}>Keep this one</Button>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </>
  )
}
