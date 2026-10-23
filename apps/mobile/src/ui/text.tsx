import type { ComponentProps } from 'react'
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextProps, type TextStyle } from 'react-native'

/*
 * The app's typeface, Atkinson Hyperlegible Next: designed for low vision, it tells 0 from O and 1 from l and I,
 * which matters for codes and phone numbers copied by hand. Android has no app-wide default font and does not
 * derive bold from a custom font, so these wrappers pick the file for each weight; screens import Text and
 * TextInput from here instead of react-native.
 */

export const FONTS = {
  'Atkinson-400': require('@expo-google-fonts/atkinson-hyperlegible-next/400Regular/AtkinsonHyperlegibleNext_400Regular.ttf'),
  'Atkinson-500': require('@expo-google-fonts/atkinson-hyperlegible-next/500Medium/AtkinsonHyperlegibleNext_500Medium.ttf'),
  'Atkinson-600': require('@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold/AtkinsonHyperlegibleNext_600SemiBold.ttf'),
  'Atkinson-700': require('@expo-google-fonts/atkinson-hyperlegible-next/700Bold/AtkinsonHyperlegibleNext_700Bold.ttf'),
  'Atkinson-800': require('@expo-google-fonts/atkinson-hyperlegible-next/800ExtraBold/AtkinsonHyperlegibleNext_800ExtraBold.ttf'),
  'AtkinsonMono-500': require('@expo-google-fonts/atkinson-hyperlegible-mono/500Medium/AtkinsonHyperlegibleMono_500Medium.ttf'),
}

const BY_WEIGHT: Record<string, string> = { normal: '400', bold: '700', '100': '400', '200': '400', '300': '400', '400': '400', '500': '500', '600': '600', '700': '700', '800': '800', '900': '800' }

function typeface(style: TextProps['style']) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle
  // 'monospace' asks for the code face (the slip code); any other family set by hand is left alone.
  if (flat.fontFamily === 'monospace') return [style, { fontFamily: 'AtkinsonMono-500', fontWeight: 'normal' as const }]
  if (flat.fontFamily) return style
  return [style, { fontFamily: `Atkinson-${BY_WEIGHT[String(flat.fontWeight ?? '400')] ?? '400'}`, fontWeight: 'normal' as const }]
}

/**
 * Large text settings are honoured up to this multiple; past it, rows and buttons would clip. Fixed-height rows
 * (Today) grow by `rowScale()`, so their text always fits.
 */
export const MAX_TEXT_SCALE = 1.5
export const rowScale = (fontScale: number) => Math.min(Math.max(fontScale, 1), MAX_TEXT_SCALE)

// React 19 passes `ref` as an ordinary prop, so the spread carries it through.
export function Text({ style, maxFontSizeMultiplier = MAX_TEXT_SCALE, ...props }: ComponentProps<typeof RNText>) {
  return <RNText {...props} maxFontSizeMultiplier={maxFontSizeMultiplier} style={typeface(style)} />
}

export function TextInput({ style, maxFontSizeMultiplier = MAX_TEXT_SCALE, ...props }: ComponentProps<typeof RNTextInput>) {
  return <RNTextInput {...props} maxFontSizeMultiplier={maxFontSizeMultiplier} style={typeface(style)} />
}
