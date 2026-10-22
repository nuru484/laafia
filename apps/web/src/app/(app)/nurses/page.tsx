'use client'

import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { FormField } from '@/components/shared/form-field'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LEVEL, byLevel } from '@/features/facilities/labels'
import { ago } from '@/features/referrals/labels'
import { errorMessage } from '@/redux/api'
import { useCreateDeviceMutation, useDeactivateDeviceMutation, useDevicesQuery, useFacilitiesQuery, useReissueCodeMutation, useUpdateDeviceMutation } from '@/redux/endpoints'
import type { Device } from '@/types/api'

const STALE_MS = 3 * 86_400_000

function state(d: Device): { label: string; tone: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (!d.active) return { label: 'Deactivated', tone: 'secondary' }
  if (!d.activated_at) return { label: 'Waiting for activation', tone: 'outline' }
  if (!d.last_sync_at || Date.now() - d.last_sync_at > STALE_MS) return { label: 'Not synced in 3 days', tone: 'destructive' }
  return { label: 'Active', tone: 'default' }
}

export default function NursesPage() {
  const { data, error, isLoading, refetch } = useDevicesQuery()
  const { data: facs } = useFacilitiesQuery()
  const [adding, setAdding] = useState<'cho' | 'facility' | null>(null)
  const [editing, setEditing] = useState<Device | null>(null)
  const [code, setCode] = useState<{ name: string; code: string; expires: number } | null>(null)
  const [retiring, setRetiring] = useState<Device | null>(null)
  const [reissue] = useReissueCodeMutation()
  const [deactivate] = useDeactivateDeviceMutation()
  const facilities = [...(facs?.facilities ?? [])].sort(byLevel)
  const rank = (code: string | null) => { const i = facilities.findIndex((f) => f.code === code); return i < 0 ? facilities.length : i }
  // Grouped by facility in level order, so each nurse is listed under her CHPS, health centre or hospital.
  const devices = (data?.devices ?? []).filter((d) => d.role !== 'gateway').sort((a, b) => rank(a.facility_code) - rank(b.facility_code) || a.user_name.localeCompare(b.user_name))
  const options = facilities.map((f) => ({ value: f.code, label: `${f.name} (${LEVEL[f.level]})` }))

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
      <Button variant="outline" className="h-11 md:h-8" onClick={() => setEditing(d)}>Edit</Button>
      <Button variant="outline" className="h-11 md:h-8" onClick={() => newCode(d)}>{d.activated_at ? 'Replace phone' : 'New code'}</Button>
      {d.active ? <Button variant="outline" className="h-11 md:h-8" onClick={() => setRetiring(d)}>Deactivate</Button> : null}
    </>
  )

  return (
    <>
      <PageHeader title="Nurses" description="Each nurse works from one facility: a CHPS compound, health centre or hospital. Add her to get the 8-digit code she enters on her phone with her number." actions={<Button className="h-11" onClick={() => setAdding('cho')}>Add nurse</Button>} />
      {isLoading ? <LoadingRows /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <div className="flex flex-col gap-8">
          <DeviceList devices={devices.filter((d) => d.role === 'cho')} actions={actions} empty="No nurses yet" />
          <section className="flex flex-col gap-3" aria-labelledby="facility-phones">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="facility-phones" className="text-lg font-semibold">Facility phones</h2>
                <p className="text-sm text-muted-foreground">The phone at a health centre or hospital that receives referrals and texts back each step.</p>
              </div>
              <Button variant="outline" className="h-11" onClick={() => setAdding('facility')}>Add facility phone</Button>
            </div>
            <DeviceList devices={devices.filter((d) => d.role === 'facility')} actions={actions} empty="No facility phones yet" />
          </section>
        </div>
      )}

      <AddPhone role={adding} onClose={() => setAdding(null)} facilities={options} onCreated={setCode} />
      {editing ? <EditPhone device={editing} facilities={options} onClose={() => setEditing(null)} /> : null}

      <Dialog open={!!code} onOpenChange={(o) => { if (!o) setCode(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activation code for {code?.name}</DialogTitle>
            <DialogDescription>Enter it on the phone with internet. It works once and expires {code ? new Date(code.expires).toLocaleString() : ''}.</DialogDescription>
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

function DeviceList({ devices, actions, empty }: { devices: Device[]; actions: (d: Device) => ReactNode; empty: string }) {
  if (!devices.length) return <EmptyState title={empty} />
  return (
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
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{d.facility_name ?? d.facility_code} · {d.phone_number ?? 'no number yet'}</p>
              <p className="text-sm text-muted-foreground">{d.last_sync_at ? `Synced ${ago(d.last_sync_at)}` : 'Never synced'}{d.app_version ? ` · app ${d.app_version}` : ''}</p>
              <div className="flex flex-wrap gap-2">{actions(d)}</div>
            </li>
          )
        })}
      </ul>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Facility</TableHead><TableHead>Phone</TableHead><TableHead>Last sync</TableHead><TableHead>State</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {devices.map((d) => {
              const st = state(d)
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.user_name}<span className="ml-2 text-xs text-muted-foreground">{d.id}</span></TableCell>
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
  )
}

function AddPhone({ role, onClose, facilities, onCreated }: { role: 'cho' | 'facility' | null; onClose: () => void; facilities: { value: string; label: string }[]; onCreated: (c: { name: string; code: string; expires: number }) => void }) {
  const [create, { isLoading }] = useCreateDeviceMutation()
  const [name, setName] = useState('')
  const [facility, setFacility] = useState('')
  const [phone, setPhone] = useState('')
  const nurse = role === 'cho'

  async function submit() {
    if (!role) return
    try {
      const r = await create({ role, user_name: name.trim(), facility_code: facility, ...(phone.trim() ? { phone_number: phone.trim() } : {}) }).unwrap()
      onClose()
      setName(''); setPhone(''); setFacility('')
      onCreated({ name: r.device.user_name, code: r.activation_code, expires: r.expires_at })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={role !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{nurse ? 'Add a nurse' : 'Add a facility phone'}</DialogTitle>
          <DialogDescription>{nurse ? 'She belongs to one facility. Her number is confirmed when she activates her phone.' : 'The phone that receives referrals at this facility.'}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField label={nurse ? 'Full name' : 'Label, e.g. Maternity ward phone'} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Facility</span>
            <FilterSelect label="Facility" value={facility} onChange={setFacility} options={[{ value: '', label: 'Choose a facility' }, ...facilities]} />
          </div>
          <FormField label="Phone number (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button className="h-11" disabled={!name.trim() || !facility || isLoading} onClick={submit}>{isLoading ? 'Creating' : 'Create and show code'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditPhone({ device, facilities, onClose }: { device: Device; facilities: { value: string; label: string }[]; onClose: () => void }) {
  const [update, { isLoading }] = useUpdateDeviceMutation()
  const [name, setName] = useState(device.user_name)
  const [facility, setFacility] = useState(device.facility_code ?? '')
  const [phone, setPhone] = useState(device.phone_number ?? '')
  const badPhone = phone.trim() !== '' && phone.replace(/\D/g, '').length < 9

  async function save() {
    try {
      await update({ id: device.id, user_name: name.trim(), facility_code: facility, phone_number: phone.trim() || null }).unwrap()
      toast.success(`${name.trim()} is updated. Phones get it on their next sync.`)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {device.user_name}</DialogTitle>
          <DialogDescription>Acknowledgements and status texts go to this number.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField label={device.role === 'cho' ? 'Full name' : 'Label'} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Facility</span>
            <FilterSelect label="Facility" value={facility} onChange={setFacility} options={facilities} />
          </div>
          <FormField label="Phone number" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={badPhone ? 'Enter a valid phone number' : undefined} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button className="h-11" disabled={!name.trim() || !facility || badPhone || isLoading} onClick={save}>{isLoading ? 'Saving' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
