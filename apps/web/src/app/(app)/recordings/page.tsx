'use client'

import { allPrompts } from '@laafia/core'
import { Mic, Play, Square, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FilterSelect } from '@/components/shared/filter-select'
import { ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { errorMessage } from '@/redux/api'
import { useClipsQuery, useDeleteClipMutation, useUploadClipMutation } from '@/redux/endpoints'
import type { Clip } from '@/types/api'

const LANGS = [{ value: 'dag', label: 'Dagbani' }, { value: 'en', label: 'English' }, { value: 'kus', label: 'Kusaal' }, { value: 'gur', label: 'Gurune' }]
const FILTERS = [{ value: 'all', label: 'All prompts' }, { value: 'missing', label: 'Missing only' }, { value: 'recorded', label: 'Recorded only' }]

export default function RecordingsPage() {
  const [lang, setLang] = useState('dag')
  const [filter, setFilter] = useState('all')
  const { data, error, isLoading, refetch } = useClipsQuery(lang)
  const prompts = useMemo(allPrompts, [])
  const byPrompt = useMemo(() => new Map((data?.clips ?? []).map((c) => [c.prompt_id, c])), [data])
  const done = prompts.filter((p) => byPrompt.has(p.id)).length
  const shown = prompts.filter((p) => (filter === 'missing' ? !byPrompt.has(p.id) : filter === 'recorded' ? byPrompt.has(p.id) : true))

  let group = ''
  return (
    <>
      <PageHeader title="Recordings" description="Each question and instruction the phones play aloud. Record them the way they are asked at the door; phones in that language's catchments download new clips on their next sync. Clips recorded on a CHO's phone appear here too." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <FilterSelect label="Language" value={lang} onChange={setLang} options={LANGS} />
        <FilterSelect label="Show" value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      <div className="mb-6 flex flex-col gap-2">
        <p className="text-sm">{done} of {prompts.length} recorded in {LANGS.find((l) => l.value === lang)?.label}</p>
        <Progress value={(done / prompts.length) * 100} aria-label="Recording progress" />
      </div>
      {isLoading ? <LoadingRows /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : (
        <div className="flex flex-col gap-2">
          {shown.map((p) => {
            const header = p.group !== group ? (group = p.group) : null
            return (
              <div key={p.id}>
                {header ? <h2 className="mt-4 mb-2 text-base font-semibold">{header}</h2> : null}
                <PromptRow id={p.id} text={p.text_en} lang={lang} clip={byPrompt.get(p.id)} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function PromptRow({ id, text, lang, clip }: { id: string; text: string; lang: string; clip: Clip | undefined }) {
  const [upload, { isLoading }] = useUploadClipMutation()
  const [remove] = useDeleteClipMutation()
  const [recording, setRecording] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function send(blob: Blob, name: string) {
    const form = new FormData()
    form.append('prompt_id', id)
    form.append('lang', lang)
    form.append('audio', blob, name)
    try {
      await upload(form).unwrap()
      toast.success('Recording saved.')
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function record() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const r = new MediaRecorder(stream)
      r.ondataavailable = (e) => chunks.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void send(new Blob(chunks, { type: r.mimeType }), `${id}.${r.mimeType.includes('ogg') ? 'ogg' : 'webm'}`)
      }
      r.start()
      recorder.current = r
      setRecording(true)
    } catch {
      toast.error('The microphone is not available in this browser.')
    }
  }
  function stop() {
    recorder.current?.stop()
    recorder.current = null
    setRecording(false)
  }

  function play() {
    if (!clip) return
    void new Audio(`/api/admin/content/clips/${clip.id}/file`).play().catch(() => toast.error('This clip could not be played.'))
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm [overflow-wrap:anywhere]">{text}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {clip ? <>Recorded {new Date(clip.recorded_at).toLocaleDateString()}{clip.recorded_by ? ` by ${clip.recorded_by}` : ''}</> : <Badge variant="outline">Missing</Badge>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {clip ? <Button variant="outline" className="h-11 sm:h-9" onClick={play} aria-label={`Play recording of: ${text}`}><Play className="size-4" aria-hidden /> Play</Button> : null}
        {recording ? (
          <Button variant="destructive" className="h-11 sm:h-9" onClick={stop}><Square className="size-4" aria-hidden /> Stop</Button>
        ) : (
          <Button variant="outline" className="h-11 sm:h-9" disabled={isLoading} onClick={record}><Mic className="size-4" aria-hidden /> {clip ? 'Record again' : 'Record'}</Button>
        )}
        <Button variant="outline" className="h-11 sm:h-9" disabled={isLoading} onClick={() => fileInput.current?.click()}><Upload className="size-4" aria-hidden /> Upload</Button>
        <input ref={fileInput} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f, f.name); e.target.value = '' }} />
        {clip ? <Button variant="ghost" className="h-11 sm:h-9" aria-label="Delete recording" onClick={() => remove(clip.id).unwrap().then(() => toast.success('Recording deleted.'), (e) => toast.error(errorMessage(e)))}><Trash2 className="size-4" aria-hidden /></Button> : null}
      </div>
    </div>
  )
}
