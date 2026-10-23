'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { FieldLabel, FormField, RequiredNote } from '@/components/shared/form-field'
import { Row, RowList, SearchInput, matches } from '@/components/shared/list'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/page'
import { ListSkeleton } from '@/components/shared/skeletons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LEVEL, byLevel } from '@/features/facilities/labels'
import { errorMessage } from '@/redux/api'
import { useCreateFacilityMutation, useDevicesQuery, useFacilitiesQuery, useUpdateFacilityMutation } from '@/redux/endpoints'
import type { Facility } from '@/types/api'

const CAPS: { value: string; label: string }[] = [
  { value: 'bemonc', label: 'Basic emergency obstetric care' },
  { value: 'cemonc', label: 'Comprehensive emergency obstetric care' },
  { value: 'theatre', label: 'Theatre' },
  { value: 'nicu', label: 'Newborn intensive care' },
]

type Draft = { id?: string; code: string; name: string; level: Facility['level']; phone: string; lat: string; lng: string; capabilities: string[] }
const empty: Draft = { code: '', name: '', level: 'chps', phone: '', lat: '', lng: '', capabilities: [] }

export default function FacilitiesPage() {
  const { data, error, isLoading, refetch } = useFacilitiesQuery()
  const { data: phones } = useDevicesQuery()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [q, setQ] = useState('')
  const facilities = [...(data?.facilities ?? [])].sort(byLevel).filter((f) => matches(q, f.name, f.code, LEVEL[f.level], f.phone, f.capabilities.join(' ')))
  const staff = (code: string) => (phones?.devices ?? []).filter((d) => d.facility_code === code && d.active && d.role !== 'gateway').length

  return (
    <>
      <PageHeader title="Facilities" description="The places: CHPS compounds, health centres and hospitals, with their level, location and what they can treat. The checklist chooses where to refer from this list. The handsets that receive the referrals are under Phones, Facility phones." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput className="sm:max-w-md sm:flex-1" value={q} onChange={setQ} placeholder="Search by name, code, level or phone" label="Search facilities" />
        <Button className="h-11 sm:ml-auto" onClick={() => setDraft(empty)}>Add facility</Button>
      </div>
      {isLoading ? <ListSkeleton rows={4} lines={[['w-44'], ['w-36'], ['w-40'], ['h-11 w-20']]} columns={['w-44', 'w-28', 'w-24', 'w-28', 'w-40', 'w-8', 'ml-auto h-8 w-14']} template="1.6fr 1fr 0.9fr 1.1fr 1.5fr 0.5fr 0.6fr" /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !data?.facilities.length ? <EmptyState title="No facilities yet" /> : !facilities.length ? <EmptyState title={`No facilities match "${q}"`} body="Check the spelling, or clear the search." /> : (
        <>
          <RowList>
            {facilities.map((f) => (
              <Row key={f.id} className="gap-1 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">{f.name}</p>
                <p className="text-muted-foreground">{LEVEL[f.level]} · {f.code}</p>
                <p className="text-muted-foreground">{f.phone ? `Referrals to ${f.phone}` : 'No referral phone yet'}</p>
                <p className="text-muted-foreground">{staff(f.code)} active {staff(f.code) === 1 ? 'phone' : 'phones'}</p>
                <Button variant="outline" className="mt-2 h-11 self-start px-5" onClick={() => setDraft(toDraft(f))}>Edit</Button>
              </Row>
            ))}
          </RowList>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>Level</TableHead><TableHead>Referral phone</TableHead><TableHead>Capabilities</TableHead><TableHead>Phones</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {facilities.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell className="text-muted-foreground">{f.code}</TableCell>
                    <TableCell>{LEVEL[f.level]}</TableCell>
                    <TableCell className="text-muted-foreground">{f.phone ?? 'Not set'}</TableCell>
                    <TableCell className="text-muted-foreground">{f.capabilities.join(', ') || '-'}</TableCell>
                    <TableCell className="tabular-nums">{staff(f.code)}</TableCell>
                    <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setDraft(toDraft(f))}>Edit</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {draft ? <FacilityDialog draft={draft} onClose={() => setDraft(null)} /> : null}
    </>
  )
}

const toDraft = (f: Facility): Draft => ({ id: f.id, code: f.code, name: f.name, level: f.level, phone: f.phone ?? '', lat: String(f.lat), lng: String(f.lng), capabilities: f.capabilities })

function FacilityDialog({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [v, setV] = useState(draft)
  const [create, c] = useCreateFacilityMutation()
  const [update, u] = useUpdateFacilityMutation()
  const lat = Number(v.lat)
  const lng = Number(v.lng)
  const valid = v.name.trim() && (v.id || /^[A-Z0-9-]{3,16}$/.test(v.code)) && v.lat !== '' && v.lng !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  const toggle = (k: 'capabilities', x: string) => setV((s) => ({ ...s, [k]: s[k].includes(x) ? s[k].filter((y) => y !== x) : [...s[k], x] }))

  async function save() {
    const body = { name: v.name.trim(), level: v.level, phone: v.phone.trim() || null, lat, lng, capabilities: v.capabilities }
    try {
      if (v.id) await update({ id: v.id, ...body }).unwrap()
      else await create({ code: v.code, ...body }).unwrap()
      toast.success(`${v.name} saved. Phones get it on their next sync.`)
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{v.id ? `Edit ${draft.name}` : 'Add a facility'}</DialogTitle><DialogDescription>A facility phone activated here sets the referral phone automatically.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-4">
          <RequiredNote />
          {!v.id ? <FormField required label="Code" placeholder="e.g. SAV-CHPS-03" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} hint="Like SAV-CHPS-02" error={v.code && !/^[A-Z0-9-]{3,16}$/.test(v.code) ? '3 to 16 capital letters, digits and dashes' : undefined} /> : null}
          <FormField required label="Name" placeholder="e.g. Nanton CHPS" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <div className="flex flex-col gap-2">
            <FieldLabel required>Level</FieldLabel>
            <FilterSelect label="Level" value={v.level} onChange={(x) => setV({ ...v, level: x as Facility['level'] })} options={Object.entries(LEVEL).map(([value, label]) => ({ value, label }))} />
          </div>
          <FormField label="Referral phone" type="tel" placeholder="e.g. 020 123 4567" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <FormField required label="Latitude" inputMode="decimal" placeholder="e.g. 9.4034" value={v.lat} onChange={(e) => setV({ ...v, lat: e.target.value })} />
            <FormField required label="Longitude" inputMode="decimal" placeholder="e.g. -0.8424" value={v.lng} onChange={(e) => setV({ ...v, lng: e.target.value })} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Capabilities</legend>
            {CAPS.map((cap) => (
              <label key={cap.value} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4" checked={v.capabilities.includes(cap.value)} onChange={() => toggle('capabilities', cap.value)} />{cap.label}</label>
            ))}
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button className="h-11" disabled={!valid || c.isLoading || u.isLoading} onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
