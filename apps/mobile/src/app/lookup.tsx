import { router } from 'expo-router'
import { useState } from 'react'
import { TYPE_NAME } from '../features/format'
import { env } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Body, Button, Card, Empty, Field, Screen } from '../ui/kit'

/** Facility register view (spec 12.1): resolve a client code from a referral to a name and household. */
export default function Lookup() {
  const [q, setQ] = useState('')
  const term = q.trim()
  const { data } = useQuery(() => term.length < 2 ? Promise.resolve([]) : env().db.all<{ id: string; code: string; name: string; type: string; community: string; landmark: string }>(
    `SELECT c.id, c.code, c.name, c.type, h.community, h.landmark FROM clients c JOIN households h ON h.id = c.household_id
      WHERE c.deleted = 0 AND (c.code LIKE ? OR c.name LIKE ?) ORDER BY c.name LIMIT 50`, [`%${term.toUpperCase()}%`, `%${term}%`]), [term])
  return (
    <Screen title="Look up a client" subtitle="By the code on a referral, or by name." right={<Button tone="quiet" label="Done" onPress={() => router.back()} />}>
      <Field label="Code or name" value={q} onChangeText={setQ} autoCapitalize="characters" autoFocus />
      {term.length >= 2 && data?.length === 0 ? <Empty title="No match in this catchment" /> : null}
      {data?.map((c) => (
        <Card key={c.id} onPress={() => router.push(`/client/${c.id}`)}>
          <Body style={{ fontWeight: '700' }}>{c.name} · {c.code}</Body>
          <Body muted>{TYPE_NAME[c.type] ?? c.type} · {c.landmark || c.community}</Body>
        </Card>
      ))}
    </Screen>
  )
}
