'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { FormField } from '@/components/shared/form-field'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/redux/api'
import { useCreateProviderMutation, useFacilitiesQuery, useProvidersQuery, useUpdateProviderMutation } from '@/redux/endpoints'
import type { Provider } from '@/types/api'

export default function DriversPage() {
  const { data, error, isLoading, refetch } = useProvidersQuery()
  const { data: facs } = useFacilitiesQuery()
  const [update] = useUpdateProviderMutation()
  const [adding, setAdding] = useState(false)

  async function toggle(p: Provider) {
    try {
      await update({ id: p.id, active: !p.active }).unwrap()
      toast.success(p.active ? `${p.name} is no longer offered for pickups.` : `${p.name} is offered for pickups again.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const providers = [...(data?.providers ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.community.localeCompare(b.community))
  return (
    <>
      <PageHeader title="Drivers" description="Motor king riders, community ambulances and taxis CHOs can text for a pickup. They need no app; any phone that reads SMS works." actions={<Button className="h-11" onClick={() => setAdding(true)}>Add driver</Button>} />
      {isLoading ? <LoadingRows /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !providers.length ? <EmptyState title="No drivers registered" body="CHOs can also add drivers from their phones." /> : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {providers.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2"><p className="min-w-0 font-medium [overflow-wrap:anywhere]">{p.name}</p>{!p.active ? <Badge variant="secondary">Retired</Badge> : null}</div>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{p.vehicle || 'Vehicle not given'} · {p.community || 'Any community'} · {p.phone}</p>
                <Button variant="outline" className="h-11" onClick={() => toggle(p)}>{p.active ? 'Retire' : 'Restore'}</Button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Vehicle</TableHead><TableHead>Community</TableHead><TableHead>Phone</TableHead><TableHead>Compound</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {providers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}{!p.active ? <Badge variant="secondary" className="ml-2">Retired</Badge> : null}</TableCell>
                    <TableCell>{p.vehicle || '-'}</TableCell>
                    <TableCell>{p.community || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{p.facility_code}</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => toggle(p)}>{p.active ? 'Retire' : 'Restore'}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <AddDriver open={adding} onOpenChange={setAdding} facilities={(facs?.facilities ?? []).filter((f) => f.level === 'chps').map((f) => ({ value: f.code, label: f.name }))} />
    </>
  )
}

function AddDriver({ open, onOpenChange, facilities }: { open: boolean; onOpenChange: (o: boolean) => void; facilities: { value: string; label: string }[] }) {
  const [create, { isLoading }] = useCreateProviderMutation()
  const [v, setV] = useState({ facility_code: '', name: '', phone: '', vehicle: '', community: '' })
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }))
  const phoneOk = v.phone.replace(/\D/g, '').length >= 9

  async function submit() {
    try {
      await create(v).unwrap()
      toast.success(`${v.name} added. CHOs see the driver on their next sync.`)
      setV({ facility_code: '', name: '', phone: '', vehicle: '', community: '' })
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add a driver</DialogTitle><DialogDescription>Registered with the CHPS compound whose CHOs will call them.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">CHPS compound</span>
            <FilterSelect label="CHPS compound" value={v.facility_code} onChange={(x) => setV((s) => ({ ...s, facility_code: x }))} options={[{ value: '', label: 'Choose a compound' }, ...facilities]} />
          </div>
          <FormField label="Name" value={v.name} onChange={set('name')} autoComplete="off" />
          <FormField label="Phone" type="tel" value={v.phone} onChange={set('phone')} error={v.phone && !phoneOk ? 'Enter a valid phone number' : undefined} />
          <FormField label="Vehicle" value={v.vehicle} onChange={set('vehicle')} placeholder="motor king, taxi, community ambulance" />
          <FormField label="Community" value={v.community} onChange={set('community')} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11" disabled={!v.facility_code || !v.name.trim() || !phoneOk || isLoading} onClick={submit}>Add driver</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
