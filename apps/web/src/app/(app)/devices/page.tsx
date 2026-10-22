'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { FormField } from '@/components/shared/form-field'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ago } from '@/features/referrals/labels'
import { errorMessage } from '@/redux/api'
import { useCreateDeviceMutation, useDeactivateDeviceMutation, useDevicesQuery, useFacilitiesQuery, useReissueCodeMutation } from '@/redux/endpoints'
import type { Device } from '@/types/api'

const ROLE: Record<string, string> = { cho: 'CHO', facility: 'Facility phone' }
const STALE_MS = 3 * 86_400_000

function state(d: Device): { label: string; tone: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (!d.active) return { label: 'Deactivated', tone: 'secondary' }
  if (!d.activated_at) return { label: 'Waiting for activation', tone: 'outline' }
  if (!d.last_sync_at || Date.now() - d.last_sync_at > STALE_MS) return { label: 'Not synced in 3 days', tone: 'destructive' }
  return { label: 'Active', tone: 'default' }
}

export default function DevicesPage() {
  const { data, error, isLoading, refetch } = useDevicesQuery()
  const { data: facs } = useFacilitiesQuery()
  const [adding, setAdding] = useState(false)
  const [code, setCode] = useState<{ name: string; code: string; expires: number } | null>(null)
  const [retiring, setRetiring] = useState<Device | null>(null)
  const [reissue] = useReissueCodeMutation()
  const [deactivate] = useDeactivateDeviceMutation()
  const devices = (data?.devices ?? []).filter((d) => d.role !== 'gateway')

  async function newCode(d: Device) {
    try {
      const r = await reissue(d.id).unwrap()
      setCode({ name: d.user_name, code: r.activation_code, expires: r.expires_at })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function retire() {
    if (!retiring) return
    try {
      await deactivate(retiring.id).unwrap()
      toast.success(`${retiring.user_name}'s phone is deactivated. It wipes its data on its next sync, and its SMS are no longer trusted.`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setRetiring(null)
    }
  }

  const actions = (d: Device) => (
    <>
      <Button variant="outline" className="h-11 md:h-8" onClick={() => newCode(d)}>{d.activated_at ? 'Replace phone' : 'New code'}</Button>
      {d.active ? <Button variant="outline" className="h-11 md:h-8" onClick={() => setRetiring(d)}>Deactivate</Button> : null}
    </>
  )

  return (
    <>
      <PageHeader title="Phones" description="Each CHO and facility phone. Create one to get its 8-digit activation code; the phone downloads its catchment when it is activated." actions={<Button className="h-11" onClick={() => setAdding(true)}>Add phone</Button>} />
      {isLoading ? <LoadingRows /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !devices.length ? <EmptyState title="No phones yet" /> : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {devices.map((d) => {
              const st = state(d)
              return (
                <li key={d.id} className="flex flex-col gap-2 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{d.user_name}</p>
                    <Badge variant={st.tone}>{st.label}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{ROLE[d.role]} · {d.facility_name ?? d.facility_code} · {d.id}</p>
                  <p className="text-sm text-muted-foreground">{d.last_sync_at ? `Synced ${ago(d.last_sync_at)}` : 'Never synced'}{d.app_version ? ` · app ${d.app_version}` : ''}</p>
                  <div className="flex gap-2">{actions(d)}</div>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Role</TableHead><TableHead>Facility</TableHead><TableHead>Phone</TableHead><TableHead>Last sync</TableHead><TableHead>State</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {devices.map((d) => {
                  const st = state(d)
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.user_name}<span className="ml-2 text-xs text-muted-foreground">{d.id}</span></TableCell>
                      <TableCell>{ROLE[d.role]}</TableCell>
                      <TableCell className="text-muted-foreground">{d.facility_name ?? d.facility_code}</TableCell>
                      <TableCell className="text-muted-foreground">{d.phone_number ?? '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{d.last_sync_at ? ago(d.last_sync_at) : 'Never'}</TableCell>
                      <TableCell><Badge variant={st.tone}>{st.label}</Badge></TableCell>
                      <TableCell className="text-right"><div className="flex justify-end gap-2">{actions(d)}</div></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <AddPhone open={adding} onOpenChange={setAdding} facilities={(facs?.facilities ?? []).map((f) => ({ value: f.code, label: f.name }))} onCreated={setCode} />

      <Dialog open={!!code} onOpenChange={(o) => { if (!o) setCode(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activation code for {code?.name}</DialogTitle>
            <DialogDescription>Enter it on the phone at the facility, with internet. It works once and expires {code ? new Date(code.expires).toLocaleString() : ''}.</DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-muted py-6 text-center font-mono text-4xl font-semibold tracking-[0.3em] tabular-nums" aria-label={`Activation code ${code?.code.split('').join(' ')}`}>{code?.code}</p>
          <DialogFooter><Button className="h-11" onClick={() => setCode(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!retiring} onOpenChange={(o) => { if (!o) setRetiring(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {retiring?.user_name}'s phone?</AlertDialogTitle>
            <AlertDialogDescription>Use this for a lost or replaced phone. It wipes its local data on its next sync and its signed SMS are no longer accepted. Records it already synced stay on the server.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={retire}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AddPhone({ open, onOpenChange, facilities, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; facilities: { value: string; label: string }[]; onCreated: (c: { name: string; code: string; expires: number }) => void }) {
  const [create, { isLoading }] = useCreateDeviceMutation()
  const [role, setRole] = useState('cho')
  const [name, setName] = useState('')
  const [facility, setFacility] = useState('')
  const [phone, setPhone] = useState('')

  async function submit() {
    try {
      const r = await create({ role, user_name: name.trim(), facility_code: facility, ...(phone.trim() ? { phone_number: phone.trim() } : {}) }).unwrap()
      onOpenChange(false)
      setName(''); setPhone('')
      onCreated({ name: r.device.user_name, code: r.activation_code, expires: r.expires_at })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a phone</DialogTitle>
          <DialogDescription>The phone number is confirmed when the phone is activated.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Who uses it</span>
            <FilterSelect label="Role" value={role} onChange={setRole} options={[{ value: 'cho', label: 'Community Health Officer' }, { value: 'facility', label: 'Facility phone (receives referrals)' }]} />
          </div>
          <FormField label={role === 'facility' ? 'Facility phone label' : 'Full name'} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Facility</span>
            <FilterSelect label="Facility" value={facility} onChange={setFacility} options={[{ value: '', label: 'Choose a facility' }, ...facilities]} />
          </div>
          <FormField label="Phone number (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11" disabled={!name.trim() || !facility || isLoading} onClick={submit}>{isLoading ? 'Creating' : 'Create and show code'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
