/** Map-provider seam (issue #27): one environment variable switches the
 * Transaction form's picker between Google Maps and the free Leaflet picker.

 * Configuration is part of the contract: when the provider is `google` the
 * API key is required, so a misconfigured build fails loudly at render time
 * instead of showing a broken map. The Leaflet fallback never needs a key.
 */

export type MapProvider = 'google' | 'leaflet'

export type MapConfig =
  | { provider: 'leaflet' }
  | { provider: 'google'; apiKey: string }

/** The build-time environment the resolver reads (import.meta.env). The index
 * signature lets the whole Vite env object in without a cast. */
export type MapEnv = {
  VITE_MAP_PROVIDER?: string
  VITE_GOOGLE_MAPS_API_KEY?: string
  [key: string]: unknown
}

/** env → provider. Anything that is not exactly `google` is the Leaflet
 * fallback, so a typo can never take down the picker. */
export function resolveMapProvider(env: MapEnv): MapProvider {
  return env.VITE_MAP_PROVIDER === 'google' ? 'google' : 'leaflet'
}

/** Resolve the full map configuration; throws when `google` is configured
 * without an API key (fail fast, with the fix in the message). */
export function resolveMapConfig(env: MapEnv): MapConfig {
  const provider = resolveMapProvider(env)
  if (provider === 'leaflet') return { provider }
  const apiKey = env.VITE_GOOGLE_MAPS_API_KEY ?? ''
  if (apiKey === '') {
    throw new Error(
      'VITE_GOOGLE_MAPS_API_KEY is required when VITE_MAP_PROVIDER=google. ' +
        'Set it in frontend/.env (see frontend/scripts/google-maps-wizard.sh) ' +
        'or switch back to VITE_MAP_PROVIDER=leaflet.',
    )
  }
  return { provider: 'google', apiKey }
}
