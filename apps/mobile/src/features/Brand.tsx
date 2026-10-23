import { Image, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { color } from '../ui/theme'

const LOGO = require('../../assets/images/logo.png')

/** The emblem and the name, for the lock and activation screens. */
export function Brand({ size = 64, caption }: { size?: number; caption?: string }) {
  return (
    <View style={st.wrap} accessible accessibilityLabel={`Laafia${caption ? `, ${caption}` : ''}`}>
      <Image source={LOGO} style={{ width: size, height: size }} resizeMode="contain" />
      <Text style={st.name}>Laafia</Text>
      {caption ? <Text style={st.caption}>{caption}</Text> : null}
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6 },
  name: { fontSize: 24, fontWeight: '800', color: color.text, letterSpacing: -0.4 },
  caption: { fontSize: 14, color: color.muted },
})
