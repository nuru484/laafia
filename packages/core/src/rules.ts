import type { ClientType, Outcome } from './types.ts'

/*
 * WHO checklists as decision tables (spec section 7). Not AI: every outcome
 * names the rule that produced it, and the same function runs on the CHO
 * phone, the facility phone and the server.
 */

export type Answers = Record<string, unknown>

type Range = { gte?: number; lte?: number; in?: unknown[] }
export type Condition = { all?: Condition[]; any?: Condition[] } & { [field: string]: unknown }

export type Question = {
  id: string
  type: 'yesno' | 'number' | 'select'
  text_en: string
  prompt: string
  unit?: string
  options?: string[]
  ask_if?: Condition
}

export type Rule = {
  id: string
  when: Condition
  outcome: Outcome
  urgency?: 1 | 2 | 3
  danger_sign?: string
  followup_days?: number
  actions: string[]
  stop?: boolean
}

export type Protocol = {
  id: string
  version: number
  clinical_review: string
  questions: Question[]
  rules: Rule[]
  signs: Record<string, { code: string; text_en: string; prompt: string }>
  actions: Record<string, { text_en: string; prompt: string }>
  destination: { default: string; by_danger_sign: Record<string, string> }
}

export type Evaluation = {
  outcome: Outcome
  rule_id: string
  urgency: 0 | 1 | 2 | 3
  danger_signs: string[]
  actions: string[]
  followup_days: number | null
  destination_query: string | null
}

function isRange(v: unknown): v is Range {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function matches(cond: Condition, answers: Answers): boolean {
  for (const [key, expected] of Object.entries(cond)) {
    if (key === 'all') {
      if (!(expected as Condition[]).every((c) => matches(c, answers))) return false
      continue
    }
    if (key === 'any') {
      if (!(expected as Condition[]).some((c) => matches(c, answers))) return false
      continue
    }
    const actual = answers[key]
    // An unanswered question never matches, so partial checklists only fire rules they can prove.
    if (actual === undefined || actual === null) return false
    if (isRange(expected)) {
      if (expected.in && !expected.in.includes(actual)) return false
      if (expected.gte !== undefined && !(typeof actual === 'number' && actual >= expected.gte)) return false
      if (expected.lte !== undefined && !(typeof actual === 'number' && actual <= expected.lte)) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

/** Next unanswered question that applies, in file order, or null when the checklist is complete. */
export function next(protocol: Protocol, answers: Answers): Question | null {
  return protocol.questions.find((q) => answers[q.id] === undefined && (!q.ask_if || matches(q.ask_if, answers))) ?? null
}

function union(lists: string[][]): string[] {
  return [...new Set(lists.flat())]
}

const LEVEL_RANK: Record<string, number> = { chps: 1, health_centre: 2, hospital: 3 }

function destinationRank(query: string): number {
  if (query.startsWith('nearest:capability:')) return 3
  return LEVEL_RANK[query.replace('nearest:', '')] ?? 0
}

/**
 * Refer beats follow-up beats routine. Among refer rules a `stop` rule wins,
 * else the highest urgency; danger signs and actions are collected from every
 * matching refer rule so the facility sees all of them. The destination is the
 * highest level any of the signs needs.
 */
export function evaluate(protocol: Protocol, answers: Answers): Evaluation {
  const hit = protocol.rules.filter((r) => matches(r.when, answers))
  const refers = hit.filter((r) => r.outcome === 'refer')
  if (refers.length) {
    const lead = refers.find((r) => r.stop) ?? [...refers].sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0))[0]!
    const signs = union(refers.map((r) => (r.danger_sign ? [r.danger_sign] : [])))
    const queries = signs.map((s) => protocol.destination.by_danger_sign[s] ?? protocol.destination.default)
    const destination = queries.reduce((best, q) => (destinationRank(q) > destinationRank(best) ? q : best), protocol.destination.default)
    return {
      outcome: 'refer',
      rule_id: lead.id,
      urgency: Math.max(...refers.map((r) => r.urgency ?? 1)) as 1 | 2 | 3,
      danger_signs: signs,
      actions: union([lead.actions, ...refers.map((r) => r.actions)]),
      followup_days: null,
      destination_query: destination,
    }
  }
  const followups = hit.filter((r) => r.outcome === 'followup')
  if (followups.length) {
    const lead = [...followups].sort((a, b) => (a.followup_days ?? 1) - (b.followup_days ?? 1))[0]!
    return {
      outcome: 'followup',
      rule_id: lead.id,
      urgency: 0,
      danger_signs: [],
      actions: union(followups.map((r) => r.actions)),
      followup_days: lead.followup_days ?? 1,
      destination_query: null,
    }
  }
  const routine = hit.find((r) => r.outcome === 'routine')
  return {
    outcome: 'routine',
    rule_id: routine?.id ?? 'NONE',
    urgency: 0,
    danger_signs: [],
    actions: routine?.actions ?? [],
    followup_days: null,
    destination_query: null,
  }
}

export function signCodes(protocol: Protocol, names: string[]): string[] {
  return names.map((n) => {
    const s = protocol.signs[n]
    if (!s) throw new Error(`unknown danger sign: ${n}`)
    return s.code
  })
}

/** Facility side: turn wire codes back into sign names. Unknown codes are kept as-is so nothing is silently dropped. */
export function signNames(protocol: Protocol, codes: string[]): string[] {
  const byCode = new Map(Object.entries(protocol.signs).map(([name, s]) => [s.code, name]))
  return codes.map((c) => byCode.get(c) ?? c)
}

export function protocolIdFor(type: ClientType, ageDays: number | null): 'maternal' | 'young_infant' | 'child' {
  if (type === 'pregnant' || type === 'postpartum') return 'maternal'
  if (type === 'newborn' || (ageDays !== null && ageDays < 60)) return 'young_infant'
  return 'child'
}
