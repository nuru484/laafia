import { Camera, GeoJSONSource, Layer, Map, Marker, type StyleSpecification } from '@maplibre/maplibre-react-native'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { TabBar } from '../features/TabBar'
import { tilesFile } from '../lib/content'
import { todayList } from '../lib/register'
import { currentSession, env, getContentState } from '../lib/runtime'
import { useQuery } from '../lib/useQuery'
import { Banner, Body, Card, Screen } from '../ui/kit'
import { color, space } from '../ui/theme'

/**
 * Offline district map (spec 10): a Protomaps PMTiles extract on the phone,
 * styled here without text layers (no font files needed), with today's visits
 * as numbered pins and the walking order as a line. Without the tiles the pins
 * and route still draw on a plain background; the map is never a dependency.
 */
function style(tiles: string | null): StyleSpecification {
  if (!tiles) return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#EEF1EC' } }] }
  const src = 'pm'
  return {
    version: 8,
    sources: { [src]: { type: 'vector', url: `pmtiles://${tiles}` } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#EEF1EC' } },
      { id: 'earth', type: 'fill', source: src, 'source-layer': 'earth', paint: { 'fill-color': '#F2EFE6' } },
      { id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover', paint: { 'fill-color': '#E3EBD8', 'fill-opacity': 0.7 } },
      { id: 'landuse', type: 'fill', source: src, 'source-layer': 'landuse', paint: { 'fill-color': '#E8E4D8', 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water', paint: { 'fill-color': '#B9D7EA' } },
      { id: 'roads-minor', type: 'line', source: src, 'source-layer': 'roads', filter: ['!in', 'kind', 'highway', 'major_road'], paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 4] } },
      { id: 'roads-major', type: 'line', source: src, 'source-layer': 'roads', filter: ['in', 'kind', 'highway', 'major_road'], paint: { 'line-color': '#F4C66B', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 16, 7] } },
      { id: 'buildings', type: 'fill', source: src, 'source-layer': 'buildings', minzoom: 14, paint: { 'fill-color': '#D9D3C7' } },
    ],
  }
}

export default function MapScreen() {
  const s = currentSession()
  const origin = { lat: s?.facility.lat ?? 9.6, lng: s?.facility.lng ?? -0.8 }
  const { data } = useQuery(() => todayList(env(), origin, 12))
  const tiles = tilesFile()?.uri ?? null
  const mapStyle = useMemo(() => style(tiles), [tiles])
  const content = getContentState()

  const stops = (data ?? []).filter((r) => r.lat !== null && r.lng !== null)
  const line = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [[origin.lng, origin.lat], ...stops.map((r) => [r.lng!, r.lat!])] } }
  const lngs = [origin.lng, ...stops.map((r) => r.lng!)]
  const lats = [origin.lat, ...stops.map((r) => r.lat!)]
  const pad = 0.004
  const bounds: [number, number, number, number] = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad]
  const unplaced = (data ?? []).length - stops.length

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Today's route" subtitle={`${stops.length} houses in walking order from ${s?.facility.name ?? 'the compound'}`} scroll={false}>
        {!tiles ? <Banner tone="followup" text={content.tiles_progress !== null ? `Downloading the district map: ${Math.round(content.tiles_progress * 100)}%` : 'District map not downloaded yet; it downloads on the next sync with internet. Pins and route still work.'} /> : null}
        <View style={{ flex: 1, borderRadius: 12, overflow: 'hidden', marginBottom: 72 }}>
          <Map style={{ flex: 1 }} mapStyle={mapStyle} logo={false} attribution={!!tiles} compass>
            <Camera initialViewState={{ bounds }} />
            <GeoJSONSource id="route" data={line}>
              <Layer id="route-line" type="line" paint={{ 'line-color': color.primary, 'line-width': 3, 'line-dasharray': [2, 1.5] }} />
            </GeoJSONSource>
            <Marker id="origin" lngLat={[origin.lng, origin.lat]}>
              <View style={{ paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: color.text }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>CHPS</Text>
              </View>
            </Marker>
            {stops.map((r, i) => (
              <Marker key={r.client_id} id={r.client_id} lngLat={[r.lng!, r.lat!]}>
                <Pressable onPress={() => router.push(`/client/${r.client_id}`)} accessibilityRole="button" accessibilityLabel={`Stop ${i + 1}, ${r.name}`}
                  style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: r.pinned ? color.refer : color.primary, borderWidth: 2, borderColor: '#fff' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>{i + 1}</Text>
                </Pressable>
              </Marker>
            ))}
          </Map>
        </View>
        {unplaced > 0 ? <Card style={{ position: 'absolute', left: space.lg, right: space.lg, bottom: 80 }}><Body muted>{unplaced} on today's list have no house position yet. Capture it at the door.</Body></Card> : null}
      </Screen>
      <TabBar />
    </View>
  )
}
