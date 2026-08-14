import { resolveMapConfig, type MapConfig } from './mapProvider'
import { GoogleMapPicker } from './googleMapPicker'
import { LeafletMapPicker } from './leafletMapPicker'
import type { LatLng } from './location'

/** The map picker, behind a provider seam (issue #27): `VITE_MAP_PROVIDER`
 * (`google` | `leaflet`) selects the adapter; the Leaflet picker is the
 * default fallback and never requires a key. The contract stays
 * `{ position, onPick }` regardless of provider. */
export function MapPicker({
  position,
  onPick,
}: {
  position: LatLng | null
  onPick: (position: LatLng) => void
}) {
  let config: MapConfig
  try {
    config = resolveMapConfig(import.meta.env)
  } catch (error) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        {error instanceof Error ? error.message : 'Map provider misconfigured.'}
      </p>
    )
  }
  if (config.provider === 'google') {
    return <GoogleMapPicker apiKey={config.apiKey} position={position} onPick={onPick} />
  }
  return <LeafletMapPicker position={position} onPick={onPick} />
}
