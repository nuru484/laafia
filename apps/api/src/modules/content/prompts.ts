import { PROTOCOLS } from '@laafia/core'

/*
 * Every clip the app can play, in recording order: questions, first-aid actions, danger signs,
 * outcomes, numbers. Mirrors apps/mobile/src/lib/prompts.ts so the dashboard's recording matrix
 * and the phone agree on prompt ids.
 */

export type Prompt = { id: string; text_en: string; group: string }

const EXTRA: Prompt[] = [
  { id: 'outcome_routine', text_en: 'All is well today. Routine care.', group: 'Outcomes' },
  { id: 'outcome_followup', text_en: 'We will come back to check again soon.', group: 'Outcomes' },
  { id: 'outcome_refer', text_en: 'This needs the health facility now.', group: 'Outcomes' },
  { id: 'unit_days', text_en: 'days', group: 'Numbers' },
  ...Array.from({ length: 31 }, (_, n) => ({ id: `num_${n}`, text_en: String(n), group: 'Numbers' })),
]

export function allPrompts(): Prompt[] {
  const seen = new Set<string>()
  const out: Prompt[] = []
  const add = (p: Prompt) => {
    if (!seen.has(p.id)) {
      seen.add(p.id)
      out.push(p)
    }
  }
  const title: Record<string, string> = { maternal: 'Mother', young_infant: 'Young infant', child: 'Child' }
  for (const p of Object.values(PROTOCOLS)) for (const q of p.questions) add({ id: q.prompt, text_en: q.text_en, group: `Questions: ${title[p.id]}` })
  for (const p of Object.values(PROTOCOLS)) for (const a of Object.values(p.actions)) add({ id: a.prompt, text_en: a.text_en, group: 'What to do now' })
  for (const p of Object.values(PROTOCOLS)) for (const s of Object.values(p.signs)) add({ id: s.prompt, text_en: s.text_en, group: 'Danger signs' })
  for (const e of EXTRA) add(e)
  return out
}
