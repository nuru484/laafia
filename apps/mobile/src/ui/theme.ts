/** One palette for the app. High contrast for outdoor screens; touch targets at least 48 dp. */
export const color = {
  bg: '#F6F7F5',
  card: '#FFFFFF',
  text: '#14201C',
  muted: '#5A6762',
  line: '#DDE3E0',
  primary: '#0F766E',
  primaryText: '#FFFFFF',
  refer: '#B42318',
  referBg: '#FEE4E2',
  followup: '#B54708',
  followupBg: '#FEF0C7',
  routine: '#067647',
  routineBg: '#DCFAE6',
  info: '#175CD3',
  infoBg: '#D1E9FF',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const
export const radius = 10
export const touch = 48
export const font = { small: 14, body: 16, title: 20, big: 26 } as const
