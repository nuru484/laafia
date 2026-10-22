'use client'

import { PROTOCOLS, type Condition, type Protocol } from '@laafia/core'
import { PageHeader } from '@/components/shared/page'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TITLE: Record<string, string> = { maternal: 'Pregnant and postpartum women', young_infant: 'Young infant, 0 to 59 days', child: 'Child, 2 to 59 months' }
const OUTCOME: Record<string, string> = { refer: 'Refer now', followup: 'Follow up', routine: 'Routine' }

/** A rule's condition in words, so a clinician can review the thresholds without reading JSON. */
function describe(c: Condition, p: Protocol): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(c)) {
    if (k === 'all') { parts.push((v as Condition[]).map((x) => describe(x, p)).join(' and ')); continue }
    if (k === 'any') { parts.push(`(${(v as Condition[]).map((x) => describe(x, p)).join(' or ')})`); continue }
    const q = p.questions.find((x) => x.id === k)
    const name = q ? `"${q.text_en}"` : k.replace(/_/g, ' ')
    if (typeof v === 'boolean') parts.push(`${name} is ${v ? 'yes' : 'no'}`)
    else if (v && typeof v === 'object') {
      const r = v as { gte?: number; lte?: number; in?: unknown[] }
      if (r.gte !== undefined && r.lte !== undefined) parts.push(`${name} between ${r.gte} and ${r.lte}${q?.unit ? ` ${q.unit}` : ''}`)
      else if (r.gte !== undefined) parts.push(`${name} at least ${r.gte}${q?.unit ? ` ${q.unit}` : ''}`)
      else if (r.lte !== undefined) parts.push(`${name} at most ${r.lte}${q?.unit ? ` ${q.unit}` : ''}`)
      if (r.in) parts.push(`${name} is one of ${r.in.join(', ')}`)
    } else parts.push(`${name} is ${String(v)}`)
  }
  return parts.join(' and ') || 'No other rule applies'
}

export default function ChecklistsPage() {
  const list = Object.values(PROTOCOLS)
  return (
    <>
      <PageHeader title="Checklists" description="The WHO danger-sign checklists exactly as the phones run them. Outcomes come only from these rules; the ranking never decides care." />
      <Tabs defaultValue={list[0]!.id}>
        <TabsList className="mb-4 flex h-auto flex-wrap">{list.map((p) => <TabsTrigger key={p.id} value={p.id}>{TITLE[p.id] ?? p.id}</TabsTrigger>)}</TabsList>
        {list.map((p) => (
          <TabsContent key={p.id} value={p.id} className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">Version {p.version}</Badge>
              <Badge variant={p.clinical_review.startsWith('pending') ? 'destructive' : 'default'}>{p.clinical_review.startsWith('pending') ? 'Clinical review pending' : 'Clinically reviewed'}</Badge>
            </div>
            <Card>
              <CardHeader><CardTitle><h2>Questions, in the order asked</h2></CardTitle></CardHeader>
              <CardContent>
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                  {p.questions.map((q) => (
                    <li key={q.id}>{q.text_en}{q.unit ? <span className="text-muted-foreground"> ({q.unit})</span> : null}{q.ask_if ? <span className="text-muted-foreground"> · asked when {describe(q.ask_if, p)}</span> : null}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle><h2>Rules</h2></CardTitle><CardDescription>Refer beats follow-up beats routine; every matching danger sign is listed on the referral.</CardDescription></CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y text-sm">
                  {p.rules.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
                        <Badge variant={r.outcome === 'refer' ? 'destructive' : r.outcome === 'followup' ? 'secondary' : 'outline'}>{OUTCOME[r.outcome]}{r.urgency ? `, urgency ${r.urgency}` : ''}{r.followup_days ? ` in ${r.followup_days} d` : ''}</Badge>
                      </div>
                      <p>When {describe(r.when, p)}.</p>
                      {r.danger_sign ? <p className="text-muted-foreground">Danger sign: {p.signs[r.danger_sign]?.text_en}</p> : null}
                      {r.actions.length ? <p className="text-muted-foreground">Tell the family: {r.actions.map((a) => p.actions[a]?.text_en).join(' ')}</p> : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}
