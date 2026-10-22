import { z } from 'zod'

// Khaya ASR language codes (from the SDK's /asr/v3/languages list) relevant to Ghana.
export const ASR_LANGUAGES = ['dag', 'eng', 'twi', 'atw', 'fat', 'ewe', 'gaa', 'gur', 'gjn', 'dga', 'kus', 'maw', 'bwu', 'xsm', 'hau', 'nzi', 'ada', 'wlx', 'xon_likoonli', 'xon_likpakpaanl'] as const

export const LangInput = z.object({ lang: z.enum(ASR_LANGUAGES).default('dag') })
