import type { Client, Visit } from './types.ts'

/*
 * Ranked visit list (spec section 6). Logistic regression over features the
 * register already holds; it ranks, it never classifies a patient.
 */

export type RiskModel = {
  version: number
  intercept: number
  weights: Record<string, number>
  reason_templates: Record<string, string>
}

export type Features = Record<string, number>
export type Reason = { feature: string; text: string }

export type Ranked = {
  client_id: string
  score: number
  reasons: Reason[]
  pinned: 'open_referral' | 'newborn_48h' | null
}

const DAY = 86_400_000
/** WHO 2016 eight-contact ANC schedule, gestational weeks, as used by GHS. */
export const ANC_WEEKS = [12, 20, 26, 30, 34, 36, 38, 40]

/** Overdue ANC saturates at four weeks so it cannot outweigh a day-old postpartum mother. */
const ANC_OVERDUE_CAP = 28

const COMPLICATION_LABEL: Record<string, string> = {
  pph: 'postpartum haemorrhage',
  pre_eclampsia: 'pre-eclampsia',
  stillbirth: 'stillbirth',
  caesarean: 'caesarean section',
}

const days = (ms: number) => Math.floor(ms / DAY)

function birthOf(c: Client): number | null {
  if (c.type === 'postpartum') return c.delivery_date
  if (c.type === 'newborn') return c.dob
  return null
}

export function features(client: Client, visits: Visit[], today: number): { x: Features; vars: Record<string, string> } {
  const x: Features = {}
  const vars: Record<string, string> = {}
  const mine = visits.filter((v) => v.client_id === client.id).sort((a, b) => a.visited_at - b.visited_at)

  if (client.type === 'pregnant' && client.edd !== null) {
    const gaDays = 280 - days(client.edd - today)
    const week = ANC_WEEKS[mine.length]
    // Every visit while pregnant counts as an ANC contact; visits carry no separate kind yet.
    if (week !== undefined) x.anc_overdue_days = Math.min(ANC_OVERDUE_CAP, Math.max(0, gaDays - week * 7))
    x.first_pregnancy = client.parity === 0 ? 1 : 0
  }

  const birth = birthOf(client)
  if (birth !== null) {
    const dpp = days(today - birth)
    const pnc = mine.filter((v) => v.visited_at >= birth).length
    x.days_postpartum_lt7 = dpp < 7 ? 1 : 0
    x.no_pnc_visit = dpp <= 42 && pnc === 0 ? 1 : 0
    vars.days_postpartum = String(dpp)
  }

  if (client.prior_complications.length) {
    x.prior_complications = 1
    const first = client.prior_complications[0]!
    vars.complication = COMPLICATION_LABEL[first] ?? first.replace(/_/g, ' ')
  }

  if ((client.type === 'newborn' || client.type === 'child') && client.birth_weight_g !== null) {
    x.low_birth_weight = client.birth_weight_g < 2500 ? 1 : 0
  }

  const muac = [...mine].reverse().find((v) => v.muac_mm !== null)?.muac_mm
  if (muac != null) {
    x.muac_class = muac < 115 ? 2 : muac < 125 ? 1 : 0
    vars.colour = muac < 115 ? 'red' : 'yellow'
  }

  const due = mine[mine.length - 1]?.followup_due
  if (due != null && due <= today) {
    x.followup_due_days = days(today - due)
    vars.followup_days = String(x.followup_due_days)
  }

  return { x, vars }
}

function render(template: string, feature: string, x: Features, vars: Record<string, string>): string {
  const daysVar: Record<string, string | undefined> = {
    anc_overdue_days: String(x.anc_overdue_days ?? ''),
    days_postpartum_lt7: vars.days_postpartum,
    followup_due_days: vars.followup_days,
  }
  return template
    .replace('{days}', daysVar[feature] ?? '')
    .replace('{complication}', vars.complication ?? '')
    .replace('{colour}', vars.colour ?? '')
    .replace(/\b1 days\b/, '1 day')
}

export function score(model: RiskModel, x: Features, vars: Record<string, string> = {}): { score: number; reasons: Reason[] } {
  let z = model.intercept
  const terms: { feature: string; value: number }[] = []
  for (const [feature, w] of Object.entries(model.weights)) {
    const v = x[feature] ?? 0
    z += w * v
    if (w * v > 0) terms.push({ feature, value: w * v })
  }
  const reasons = terms
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((t) => ({ feature: t.feature, text: render(model.reason_templates[t.feature] ?? t.feature, t.feature, x, vars) }))
  return { score: 1 / (1 + Math.exp(-z)), reasons }
}

/**
 * Score everyone, then apply the list rules (spec 6.5): open referrals and
 * newborns inside 48 h without a postnatal visit are pinned on top; a due
 * follow-up is lifted to at least 0.6.
 */
export function rank(model: RiskModel, clients: Client[], visits: Visit[], openReferralClientIds: Set<string>, today: number): Ranked[] {
  const out = clients.map((c): Ranked => {
    const { x, vars } = features(c, visits, today)
    const s = score(model, x, vars)
    let value = s.score
    if (x.followup_due_days !== undefined) value = Math.max(value, 0.6)
    const birth = birthOf(c)
    const newborn48 = c.type === 'newborn' && birth !== null && today - birth <= 2 * DAY && x.no_pnc_visit === 1
    const pinned = openReferralClientIds.has(c.id) ? 'open_referral' : newborn48 ? 'newborn_48h' : null
    return { client_id: c.id, score: value, reasons: s.reasons, pinned }
  })
  const pinRank = { open_referral: 0, newborn_48h: 1 } as const
  return out.sort((a, b) => {
    const pa = a.pinned ? pinRank[a.pinned] : 2
    const pb = b.pinned ? pinRank[b.pinned] : 2
    return pa - pb || b.score - a.score
  })
}
