'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/shared/form-field'
import { ErrorState, LoadingRows } from '@/components/shared/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorCode, errorMessage } from '@/redux/api'
import { useMapAreaQuery, useStartMapBuildMutation } from '@/redux/endpoints'
import type { Bbox } from '@/types/api'

/** Same limit as the API: about 165 km a side. */
const MAX_SPAN = 1.5
const deg = (min: number, max: number) => z.coerce.number<string>({ error: 'Enter a number' }).min(min, `At least ${min}`).max(max, `At most ${max}`)
const schema = z.object({ west: deg(-180, 180), south: deg(-85, 85), east: deg(-180, 180), north: deg(-85, 85) })
  .refine((b) => b.west < b.east, { path: ['east'], message: 'East must be greater than west' })
  .refine((b) => b.south < b.north, { path: ['north'], message: 'North must be greater than south' })
  .refine((b) => b.east - b.west <= MAX_SPAN && b.north - b.south <= MAX_SPAN, { path: ['north'], message: `At most ${MAX_SPAN} degrees a side` })
type Form = z.input<typeof schema>

const toForm = (b: Bbox): Form => ({ west: String(b[0]), south: String(b[1]), east: String(b[2]), north: String(b[3]) })
const sizeKm = (f: Form) => {
  const [w, s, e, n] = [f.west, f.south, f.east, f.north].map(Number) as Bbox
  if (![w, s, e, n].every(Number.isFinite) || w >= e || s >= n) return null
  return `about ${Math.round((e - w) * 111 * Math.cos((((s + n) / 2) * Math.PI) / 180))} × ${Math.round((n - s) * 111)} km`
}

export function MakeMap({ district, onPublished }: { district: string; onPublished: () => void }) {
  const [poll, setPoll] = useState(false)
  const area = useMapAreaQuery(district, { pollingInterval: poll ? 3000 : 0 })
  const [start, startState] = useStartMapBuildMutation()
  const build = area.data?.build
  const running = build?.status === 'running'
  const initial = area.data?.last_bbox ?? area.data?.suggested?.bbox ?? null
  const form = useForm<Form, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { west: '', south: '', east: '', north: '' } })
  const values = form.watch()

  useEffect(() => setPoll(running), [running])
  useEffect(() => {
    if (initial) form.reset(toForm(initial), { keepDirtyValues: true })
  }, [initial?.join(',')])

  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && build?.status === 'done') {
      toast.success(`Map version ${build.pack_version} published. Phones download it on their next sync with internet.`)
      onPublished()
    }
    wasRunning.current = running
  }, [running, build?.status, build?.pack_version, onPublished])

  async function onSubmit(f: z.output<typeof schema>) {
    try {
      await start({ district, bbox: [f.west, f.south, f.east, f.north] }).unwrap()
    } catch (e) {
      toast.error(errorCode(e) === 'map_build_running' ? 'This district map is already being made.' : errorMessage(e))
    }
  }

  if (area.isLoading) return <LoadingRows rows={2} />
  if (area.error || !area.data) return <ErrorState message={errorMessage(area.error)} onRetry={area.refetch} />
  const { suggested } = area.data
  const size = sizeKm(values)
  const atSuggested = !!suggested && toForm(suggested.bbox).west === values.west && toForm(suggested.bbox).south === values.south && toForm(suggested.bbox).east === values.east && toForm(suggested.bbox).north === values.north

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle><h2>Make the district map</h2></CardTitle>
        <CardDescription>The server cuts this area out of the OpenStreetMap world map, down to street level, and publishes it as the next version. It usually takes under a minute.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={running}>
            <legend className="sr-only">Area, in degrees</legend>
            <FormField label="West (longitude)" inputMode="decimal" error={form.formState.errors.west?.message} {...form.register('west')} />
            <FormField label="East (longitude)" inputMode="decimal" error={form.formState.errors.east?.message} {...form.register('east')} />
            <FormField label="South (latitude)" inputMode="decimal" error={form.formState.errors.south?.message} {...form.register('south')} />
            <FormField label="North (latitude)" inputMode="decimal" error={form.formState.errors.north?.message} {...form.register('north')} />
          </fieldset>
          <p className="text-sm text-muted-foreground">
            {size ? `The area is ${size}. ` : ''}
            {suggested
              ? `Suggested from ${suggested.facilities} facilities and ${suggested.households} households with GPS, plus 2 km around them.`
              : 'No facility or household in this district has GPS yet, so enter the area by hand.'}
          </p>
          {build?.status === 'failed' && !running ? (
            <Alert variant="destructive"><AlertDescription>The last attempt failed: {build.error}</AlertDescription></Alert>
          ) : null}
          {running ? (
            <p role="status" className="text-sm">Making the map since {new Date(build.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You can leave this page; it carries on.</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="h-11" disabled={running || startState.isLoading}>{running ? 'Making the map' : 'Make the map'}</Button>
            {suggested && !atSuggested && !running ? (
              <Button type="button" variant="outline" className="h-11" onClick={() => form.reset(toForm(suggested.bbox))}>Use the suggested area</Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
