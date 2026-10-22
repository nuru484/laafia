'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { FormField } from '@/components/shared/form-field'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/redux/api'
import {
  useBatchesQuery, useCommitBatchMutation, useCreateTemplateMutation, useFacilitiesQuery, usePreviewDhis2Mutation, usePreviewUploadMutation,
  useTemplatesQuery, useUndoBatchMutation,
} from '@/redux/endpoints'
import type { ImportBatch } from '@/types/api'

/** Fields a template maps register columns onto (docs/API.md, Register import). */
const FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: 'Client name' }, { key: 'community', label: 'Community' }, { key: 'head_name', label: 'Household head' },
  { key: 'household_ref', label: 'Household number' }, { key: 'landmark', label: 'Landmark' }, { key: 'sex', label: 'Sex' },
  { key: 'dob', label: 'Date of birth' }, { key: 'edd', label: 'Expected delivery date' }, { key: 'delivery_date', label: 'Delivery date' },
  { key: 'parity', label: 'Parity' }, { key: 'nhis_active', label: 'NHIS status' }, { key: 'lat', label: 'Latitude' }, { key: 'lng', label: 'Longitude' },
]
const TYPES = [{ value: 'pregnant', label: 'Antenatal register (pregnant women)' }, { value: 'postpartum', label: 'Postnatal register (mothers)' }, { value: 'newborn', label: 'Newborn register' }, { value: 'child', label: 'Child welfare register (under five)' }]
const STATUS: Record<ImportBatch['status'], string> = { preview: 'Preview, not saved', committed: 'Imported', undone: 'Undone' }

export default function ImportPage() {
  const { data: tpl, error, isLoading, refetch } = useTemplatesQuery()
  const { data: facs } = useFacilitiesQuery()
  const { data: batches } = useBatchesQuery()
  const [preview, setPreview] = useState<ImportBatch | null>(null)
  const [creating, setCreating] = useState<'tabular' | 'dhis2' | null>(null)
  const facilities = (facs?.facilities ?? []).filter((f) => f.level === 'chps').map((f) => ({ value: f.code, label: f.name }))

  if (isLoading) return <LoadingRows />
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />
  const templates = tpl?.templates ?? []

  return (
    <>
      <PageHeader title="Register import" description="Bring a CHPS register into Laafia once. CHO phones in that catchment receive the clients on their next sync, and a newly activated phone gets them at activation." />
      <Tabs defaultValue="file">
        <TabsList className="mb-4">
          <TabsTrigger value="file">Spreadsheet</TabsTrigger>
          <TabsTrigger value="dhis2">DHIMS2</TabsTrigger>
        </TabsList>
        <TabsContent value="file"><FileImport templates={templates.filter((t) => t.source === 'tabular')} facilities={facilities} onPreview={setPreview} onNewTemplate={() => setCreating('tabular')} /></TabsContent>
        <TabsContent value="dhis2"><Dhis2Import templates={templates.filter((t) => t.source === 'dhis2')} facilities={facilities} onPreview={setPreview} onNewTemplate={() => setCreating('dhis2')} /></TabsContent>
      </Tabs>

      {preview ? <PreviewCard batch={preview} onDone={setPreview} /> : null}

      <h2 className="mt-8 mb-3 text-lg font-semibold">Past imports</h2>
      {!batches?.batches.length ? <EmptyState title="Nothing imported yet" /> : (
        <ul className="flex flex-col gap-3">
          {batches.batches.map((b) => <BatchRow key={b.id} batch={b} facility={facs?.facilities.find((f) => f.id === b.facility_id)?.name ?? ''} onOpen={() => setPreview(b)} />)}
        </ul>
      )}
      {creating ? <TemplateDialog source={creating} onClose={() => setCreating(null)} /> : null}
    </>
  )
}

function FileImport({ templates, facilities, onPreview, onNewTemplate }: { templates: { id: string; name: string }[]; facilities: { value: string; label: string }[]; onPreview: (b: ImportBatch) => void; onNewTemplate: () => void }) {
  const [template, setTemplate] = useState('')
  const [facility, setFacility] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [upload, { isLoading }] = usePreviewUploadMutation()

  async function run() {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    form.append('template_id', template)
    form.append('facility_code', facility)
    try {
      onPreview((await upload(form).unwrap()).batch)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle><h2>From a CSV or Excel file</h2></CardTitle><CardDescription>The first row must be the column headers. Nothing is saved until you confirm the preview.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TemplatePicker templates={templates} value={template} onChange={setTemplate} onNew={onNewTemplate} />
        <div className="flex flex-col gap-2"><span className="text-sm font-medium">CHPS compound</span><FilterSelect label="CHPS compound" value={facility} onChange={setFacility} options={[{ value: '', label: 'Choose a compound' }, ...facilities]} /></div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="register-file">Register file</Label>
          <Input id="register-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="h-11" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Button className="h-11 w-full sm:w-fit" disabled={!template || !facility || !file || isLoading} onClick={run}>{isLoading ? 'Checking the file' : 'Preview import'}</Button>
      </CardContent>
    </Card>
  )
}

function Dhis2Import({ templates, facilities, onPreview, onNewTemplate }: { templates: { id: string; name: string }[]; facilities: { value: string; label: string }[]; onPreview: (b: ImportBatch) => void; onNewTemplate: () => void }) {
  const [template, setTemplate] = useState('')
  const [facility, setFacility] = useState('')
  const [orgUnit, setOrgUnit] = useState('')
  const [program, setProgram] = useState('')
  const [pull, { isLoading }] = usePreviewDhis2Mutation()

  async function run() {
    try {
      onPreview((await pull({ template_id: template, facility_code: facility, org_unit: orgUnit.trim(), ...(program.trim() ? { program: program.trim() } : {}) }).unwrap()).batch)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle><h2>From DHIMS2</h2></CardTitle><CardDescription>Pulls the tracked people of one organisation unit and programme with the district's DHIMS2 account. Nothing is saved until you confirm the preview.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TemplatePicker templates={templates} value={template} onChange={setTemplate} onNew={onNewTemplate} />
        <div className="flex flex-col gap-2"><span className="text-sm font-medium">CHPS compound</span><FilterSelect label="CHPS compound" value={facility} onChange={setFacility} options={[{ value: '', label: 'Choose a compound' }, ...facilities]} /></div>
        <FormField label="DHIMS2 organisation unit ID" value={orgUnit} onChange={(e) => setOrgUnit(e.target.value)} hint="The 11-character ID of the CHPS compound in DHIMS2." />
        <FormField label="Programme ID" value={program} onChange={(e) => setProgram(e.target.value)} hint="For example the ANC or child health programme." />
        <Button className="h-11 w-full sm:w-fit" disabled={!template || !facility || orgUnit.trim().length !== 11 || !program.trim() || isLoading} onClick={run}>{isLoading ? 'Pulling from DHIMS2' : 'Preview import'}</Button>
      </CardContent>
    </Card>
  )
}

function TemplatePicker({ templates, value, onChange, onNew }: { templates: { id: string; name: string }[]; value: string; onChange: (v: string) => void; onNew: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Column mapping</span>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1"><FilterSelect label="Column mapping" value={value} onChange={onChange} options={[{ value: '', label: templates.length ? 'Choose a saved mapping' : 'No mapping saved yet' }, ...templates.map((t) => ({ value: t.id, label: t.name }))]} /></div>
        <Button variant="outline" className="h-11" onClick={onNew}>New mapping</Button>
      </div>
      <p className="text-xs text-muted-foreground">A mapping is saved once per register form and reused for every compound that uses the same form.</p>
    </div>
  )
}

function PreviewCard({ batch, onDone }: { batch: ImportBatch; onDone: (b: ImportBatch | null) => void }) {
  const [commit, c] = useCommitBatchMutation()
  const [undo, u] = useUndoBatchMutation()
  const issues = batch.issues ?? []

  async function doCommit() {
    try {
      const r = await commit(batch.id).unwrap()
      toast.success(`${r.batch.counts.clients_created ?? 0} clients imported. Phones receive them on their next sync.`)
      onDone(r.batch)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  async function doUndo() {
    try {
      const r = await undo(batch.id).unwrap()
      toast.success(`Removed ${r.undone.clients} clients and ${r.undone.households} households${r.kept.clients ? `; kept ${r.kept.clients} edited since` : ''}.`)
      onDone(r.batch)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Card className="mt-6 border-primary/40">
      <CardHeader>
        <CardTitle><h2>{batch.status === 'preview' ? 'Preview' : STATUS[batch.status]}: {batch.filename ?? 'DHIMS2 pull'}</h2></CardTitle>
        <CardDescription>{batch.counts.rows} rows read · {batch.counts.valid} ready to import · {batch.counts.errors} with errors · {batch.counts.duplicates} duplicates · {batch.counts.households} households</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {issues.length ? (
          <div className="max-h-72 overflow-y-auto rounded-md border">
            <ul className="divide-y text-sm">
              {issues.slice(0, 200).map((i, n) => (
                <li key={n} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:gap-3">
                  <span className="shrink-0 font-medium">Row {i.row}</span>
                  <Badge variant={i.kind === 'error' ? 'destructive' : 'secondary'} className="w-fit">{i.kind === 'error' ? 'Error' : 'Duplicate'}</Badge>
                  <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{i.field ? `${i.field}: ` : ''}{i.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {batch.sample?.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">First rows to be imported</p>
            <ul className="flex flex-col gap-1 text-sm">
              {batch.sample.slice(0, 8).map((s) => <li key={s.row} className="[overflow-wrap:anywhere]">{s.client.name} · {s.client.type} · {s.household.community}, {s.household.head_name}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          {batch.status === 'preview' ? <Button className="h-11" disabled={!batch.counts.valid || c.isLoading} onClick={doCommit}>Import {batch.counts.valid} clients</Button> : null}
          {batch.status === 'committed' ? <Button variant="outline" className="h-11" disabled={u.isLoading} onClick={doUndo}>Undo this import</Button> : null}
          <Button variant="ghost" className="h-11" onClick={() => onDone(null)}>Close</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function BatchRow({ batch, facility, onOpen }: { batch: ImportBatch; facility: string; onOpen: () => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-medium [overflow-wrap:anywhere]">{batch.filename ?? 'DHIMS2 pull'} · {facility}</p>
        <p className="text-muted-foreground">{new Date(batch.created_at).toLocaleString()} · {batch.counts.clients_created ?? batch.counts.valid} clients</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={batch.status === 'committed' ? 'default' : 'secondary'}>{STATUS[batch.status]}</Badge>
        <Button variant="outline" className="h-11 sm:h-8" onClick={onOpen}>Open</Button>
      </div>
    </li>
  )
}

function TemplateDialog({ source, onClose }: { source: 'tabular' | 'dhis2'; onClose: () => void }) {
  const [create, { isLoading }] = useCreateTemplateMutation()
  const [name, setName] = useState('')
  const [type, setType] = useState('pregnant')
  const [mapping, setMapping] = useState<Record<string, string>>({})

  async function save() {
    try {
      const clean = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
      await create({ name: name.trim(), source, mapping: clean, constants: { type } }).unwrap()
      toast.success('Mapping saved.')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New column mapping</DialogTitle>
          <DialogDescription>{source === 'dhis2' ? 'For each field, the DHIMS2 attribute name or ID.' : 'For each field, the column header exactly as it appears in the file. Join columns with +, for example First name+Last name.'} Leave a field empty if the register does not have it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField label="Mapping name" value={name} onChange={(e) => setName(e.target.value)} placeholder="GHS ANC register" />
          <div className="flex flex-col gap-2"><span className="text-sm font-medium">Register</span><FilterSelect label="Register" value={type} onChange={setType} options={TYPES} /></div>
          {FIELDS.map((f) => (
            <FormField key={f.key} label={f.label} value={mapping[f.key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))} />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button className="h-11" disabled={!name.trim() || !mapping.name?.trim() || !mapping.community?.trim() || isLoading} onClick={save}>Save mapping</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
