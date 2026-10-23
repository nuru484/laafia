import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { TabBar } from '../features/TabBar'
import { TYPE_NAME } from '../features/format'
import { currentSession, env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Empty, Field, HeaderAction, Loading, Screen } from '../ui/kit'
import { color, font, space } from '../ui/theme'

type Row = { id: string; code: string; name: string; type: string; community: string; landmark: string; phone: string | null }

/**
 * The register. On a CHO phone it is the Clients tab: everyone she has enrolled or downloaded, so a client who is
 * not on today's list is still one search away. On a facility phone (spec 12.1) it resolves a referral's client
 * code to a name and household.
 */
export default function Lookup() {
  const cho = currentSession()?.role !== 'facility'
  const [q, setQ] = useState('')
  const term = q.trim()
  const { data } = useQuery(() => {
    const like = `%${term}%`
    return env().db.all<Row>(
      `SELECT c.id, c.code, c.name, c.type, c.phone, h.community, h.landmark FROM clients c JOIN households h ON h.id = c.household_id
        WHERE c.deleted = 0 AND (? = '' OR c.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR h.community LIKE ?) ORDER BY c.name LIMIT 200`,
      [term, `%${term.toUpperCase()}%`, like, `%${term.replace(/\D/g, '') || '~'}%`, like])
  }, [term])

  const list = (
    <>
      <Field label="Search" value={q} onChangeText={setQ} autoCorrect={false} placeholder="Name, code, phone or community" />
      {!data ? <Loading /> : data.length === 0 ? <Empty title={term ? 'No one matches' : 'No clients yet'} body={term ? 'Check the spelling, or search by her code or phone.' : 'Enrol households as you visit, or pull down to download the register.'} /> : (
        <View style={st.list}>
          {data.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/client/${c.id}`)} accessibilityRole="button" accessibilityLabel={`${c.name}, ${TYPE_NAME[c.type] ?? c.type}, ${c.community}`}
              style={({ pressed }) => [st.row, pressed && { backgroundColor: color.primaryBg }]}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={st.name} numberOfLines={1}>{c.name}</Text>
                <Text style={st.meta} numberOfLines={1}>{TYPE_NAME[c.type] ?? c.type} · {c.code} · {c.landmark || c.community}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={color.muted} />
            </Pressable>
          ))}
        </View>
      )}
    </>
  )

  if (!cho) return <Screen title="Look up a client" subtitle="By the code on a referral, or by name." onBack={() => router.back()}>{list}</Screen>
  return (
    <View style={{ flex: 1 }}>
      <Screen title="Clients" subtitle={data && !term ? `${data.length} on your register` : undefined}
        right={<HeaderAction icon="person-add-outline" label="Enrol" onPress={() => router.push('/enrol')} />}>
        {list}
      </Screen>
      <TabBar />
    </View>
  )
}

const st = StyleSheet.create({
  list: { marginHorizontal: -space.lg, borderTopWidth: 1, borderColor: color.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingHorizontal: space.lg, paddingVertical: 10, backgroundColor: color.card, borderBottomWidth: 1, borderColor: color.line },
  name: { fontSize: font.body + 1, fontWeight: '600', color: color.text },
  meta: { fontSize: font.small, color: color.muted },
})
