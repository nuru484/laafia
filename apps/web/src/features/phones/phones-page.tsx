'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { FieldLabel, FormField, RequiredNote } from '@/components/shared/form-field'
import { useConfirm } from '@/components/shared/confirm'
import { ActionsMenu, Row, RowList, SearchInput, matches, type Action } from '@/components/shared/list'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/page'
import { ListSkeleton } from '@/components/shared/skeletons'
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

const COPY = {
  cho: {
    title: 'Nurses', add: 'Add nurse', noun: 'nurses',
    description: 'Each nurse works from one facility: a CHPS compound, health centre or hospital. Add her to get the 8-digit code she enters on her phone with her number.',
  },
  facility: {
    title: 'Facility phones', add: 'Add facility phone', noun: 'facility phones',
    description: 'The handsets at the facilities: each one receives the referral SMS sent to its facility, rings for emergencies and texts the CHO back each step. The places themselves are under Facilities.',
  },
} as const

/** One kind of phone per page: CHO phones under Nurses, the receiving phones under Facility phones. */
export function PhonesPage({ role }: { role: 'cho' | 'facility' }) {
  const copy = COPY[role]
  const { data, error, isLoading, refetch } = useDevicesQuery()
  const { data: facs } = useFacilitiesQuery()
  const [adding, setAdding] = useState<'cho' | 'facility' | null>(null)
  const [editing, setEditing] = useState<Device | null>(null)
  const [code, setCode] = useState<{ name: string; code: string; expires: number } | null>(null)
  const [retiring, setRetiring] = useState<Device | null>(null)
  const [q, setQ] = useState('')
  const [reissue] = useReissueCodeMutation()
  const [deactivate] = useDeactivateDeviceMutation()
  const facilities = [...(facs?.facilities ?? [])].sort(byLevel)
  const rank = (code: string | null) => { const i = facilities.findIndex((f) => f.code === code); return i < 0 ? facilities.length : i }
  // Grouped by facility in level order, so each nurse is listed under her CHPS, health centre or hospital.
  const devices = (data?.devices ?? []).filter((d) => d.role !== 'gateway' && matches(q, d.user_name, d.phone_number, d.facility_name, d.facility_code, d.id, state(d).label)).sort((a, b) => rank(a.facility_code) - rank(b.facility_code) || a.user_name.localeCompare(b.user_name))
  const options = facilities.map((f) => ({ value: f.code, label: `${f.name} (${LEVEL[f.level]})` }))

  const [confirm, confirmDialog] = useConfirm()

  async function newCode(d: Device) {
    const ok = await confirm({
      title: d.activated_at ? `Replace ${d.user_name}'s phone?` : `New code for ${d.user_name}?`,
      body: d.activated_at
        ? 'A new 8-digit code is issued and any earlier unused code stops working. The phone that activates with it becomes this nurse\'s phone; deactivate the old one if it was lost.'
        : 'A new 8-digit code is issued and the earlier one stops working.',
      confirm: d.activated_at ? 'Issue a code for the new phone' : 'Issue a new code',
    })
    if (!ok) return
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

  const actions = (d: Device): Action[] => [
    { label: 'Edit', onSelect: () => setEditing(d) },
    { label: d.activated_at ? 'Replace phone' : 'New code', onSelect: () => void newCode(d) },
    ...(d.active ? [{ label: 'Deactivate', onSelect: () => setRetiring(d), destructive: true }] : []),
  ]

  return (
    <>
      <PageHeader title={copy.title} description={copy.description} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput className="sm:max-w-md sm:flex-1" value={q} onChange={setQ} placeholder="Search by name, phone, facility or phone ID" label={`Search ${copy.noun}`} />
        <Button className="h-11 sm:ml-auto" onClick={() => setAdding(role)}>{copy.add}</Button>
      </div>
      {isLoading ? <ListSkeleton rows={3} lines={[['w-36', 'h-5 w-28'], ['w-52'], ['w-40'], ['h-11 w-28']]} columns={['w-36', 'w-40', 'w-28', 'w-20', 'h-5 w-28', 'ml-auto size-8']} template="1.4fr 1.4fr 1fr 0.8fr 1.1fr 0.4fr" /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <DeviceList devices={devices.filter((d) => d.role === role)} actions={actions} empty={q ? `No ${copy.noun} match "${q}"` : `No ${copy.noun} yet`} />
      )}

      {confirmDialog}
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

function DeviceList({ devices, actions, empty }: { devices: Device[]; actions: (d: Device) => Action[]; empty: string }) {
  if (!devices.length) return <EmptyState title={empty} />
  return (
    <>
      <RowList>
        {devices.map((d) => {
          const st = state(d)
          return (
            <Row key={d.id}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{d.user_name}</p>
                <Badge variant={st.tone}>{st.label}</Badge>
              </div>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{d.facility_name ?? d.facility_code} · {d.phone_number ?? 'no number yet'}</p>
              <p className="text-sm text-muted-foreground">{d.last_sync_at ? `Synced ${ago(d.last_sync_at)}` : 'Never synced'}{d.app_version ? ` · app ${d.app_version}` : ''}</p>
              <div className="mt-1"><ActionsMenu label={d.user_name} actions={actions(d)} /></div>
            </Row>
          )
        })}
      </RowList>
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
                  <TableCell className="text-right"><ActionsMenu compact label={d.user_name} actions={actions(d)} /></TableCell>
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
          <RequiredNote />
          <FormField required label={nurse ? 'Full name' : 'Label'} placeholder={nurse ? 'e.g. Abena Mensah' : 'e.g. Maternity ward phone'} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <div className="flex flex-col gap-2">
            <FieldLabel required>Facility</FieldLabel>
            <FilterSelect label="Facility" value={facility} onChange={setFacility} options={[{ value: '', label: 'Choose a facility' }, ...facilities]} />
          </div>
          <FormField label="Phone number" type="tel" placeholder="e.g. 024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
          <RequiredNote />
          <FormField required label={device.role === 'cho' ? 'Full name' : 'Label'} placeholder={device.role === 'cho' ? 'e.g. Abena Mensah' : 'e.g. Maternity ward phone'} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <div className="flex flex-col gap-2">
            <FieldLabel required>Facility</FieldLabel>
            <FilterSelect label="Facility" value={facility} onChange={setFacility} options={facilities} />
          </div>
          <FormField label="Phone number" type="tel" placeholder="e.g. 024 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} error={badPhone ? 'Enter a valid phone number' : undefined} />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button className="h-11" disabled={!name.trim() || !facility || badPhone || isLoading} onClick={save}>{isLoading ? 'Saving' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
