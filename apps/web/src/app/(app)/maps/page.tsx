'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/redux/api'
import { useMeQuery, usePacksQuery, useUploadPackMutation } from '@/redux/endpoints'

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export default function MapsPage() {
  const { data: me } = useMeQuery()
  const district = me?.user.district?.code ?? ''
  const { data, error, isLoading, refetch } = usePacksQuery()
  const [upload, { isLoading: uploading }] = useUploadPackMutation()
  const [file, setFile] = useState<File | null>(null)
  const tiles = (data?.packs ?? []).filter((p) => p.kind === 'tiles')

  async function send() {
    if (!file) return
    const form = new FormData()
    form.append('kind', 'tiles')
    form.append('district_code', district)
    form.append('file', file)
    try {
      const r = await upload(form).unwrap()
      toast.success(`Version ${r.pack.version} uploaded. Phones download it on their next sync with internet.`)
      setFile(null)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader title="Maps" description="The offline district map the phones draw the visit route on. Phones download the newest version once, and resume if the connection drops." />
      <Card className="mb-6">
        <CardHeader><CardTitle><h2>Upload a district map</h2></CardTitle><CardDescription>A PMTiles extract of OpenStreetMap for the district, made with scripts/district-map.sh. About 7 MB for Savelugu.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="pmtiles">PMTiles file</Label>
            <Input id="pmtiles" type="file" accept=".pmtiles" className="h-11" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button className="h-11" disabled={!file || !district || uploading} onClick={send}>{uploading ? 'Uploading' : 'Upload'}</Button>
        </CardContent>
      </Card>
      {isLoading ? <LoadingRows rows={2} /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !tiles.length ? <EmptyState title="No map uploaded" body="Phones still show the route and house pins on a plain background." /> : (
        <ul className="flex flex-col gap-3">
          {tiles.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-1 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">{p.district_code} map, version {p.version}{i === 0 ? ' (current)' : ''}</span>
              <span className="text-muted-foreground">{mb(p.size)} · {new Date(p.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
