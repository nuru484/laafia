import { PROTOCOLS, type ClientWireType } from '@laafia/core'

const PRIMARY: Record<ClientWireType, keyof typeof PROTOCOLS> = { PW: 'maternal', PP: 'maternal', NB: 'young_infant', CH: 'child' }

/** Codes are unique within a protocol; a child under two months uses the young infant table, so fall back across protocols. */
function protocolsFor(type: ClientWireType) {
  const first = PROTOCOLS[PRIMARY[type] ?? 'child']
  return [first, ...Object.values(PROTOCOLS).filter((p) => p !== first)]
}

function find(type: ClientWireType, code: string) {
  for (const p of protocolsFor(type)) for (const [name, s] of Object.entries(p.signs)) if (s.code === code) return { name, ...s }
  return null
}

export function namesFromCodes(type: ClientWireType, codes: string[]): string[] {
  return codes.map((c) => find(type, c)?.name ?? c)
}
export function codesFromNames(type: ClientWireType, names: string[]): string[] {
  return names.map((n) => protocolsFor(type).find((p) => p.signs[n])?.signs[n]?.code ?? n)
}
/** Plain-language danger signs for a referral card. An unknown code is shown as-is rather than dropped. */
export function signLabels(type: ClientWireType, codes: string[]): string[] {
  return codes.map((c) => find(type, c)?.text_en ?? `Sign ${c}`)
}

export const TYPE_LABEL: Record<string, string> = { PW: 'Pregnant woman', PP: 'Mother after delivery', NB: 'Newborn', CH: 'Child' }
