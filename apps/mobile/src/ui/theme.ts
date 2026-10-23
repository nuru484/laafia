/**
 * One palette for the app: cool greys, a deep sea blue for anything you can press, the UNICEF cyan as the brand
 * accent, and red, amber and green kept for triage alone. High contrast for outdoor screens; touch targets 48 dp.
 */
export const color = {
  bg: '#F3F6F8',
  card: '#FFFFFF',
  text: '#0E1B22',
  muted: '#566770',
  line: '#DCE3E7',
  primary: '#0077A8',
  primaryBg: '#E2F3FA',
  primaryText: '#FFFFFF',
  accent: '#1CABE2',
  refer: '#B42318',
  referBg: '#FEE4E2',
  followup: '#B54708',
  followupBg: '#FEF0C7',
  routine: '#067647',
  routineBg: '#DCFAE6',
  info: '#0077A8',
  infoBg: '#E2F3FA',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
// A slight rounding on every corner: crisp, clinical, not boxy. Status dots stay round.
export const radius = 4
export const touch = 48
export const font = { small: 14, body: 16, title: 20, big: 26 } as const
