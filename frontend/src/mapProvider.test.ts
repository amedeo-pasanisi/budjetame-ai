import { describe, expect, it } from 'vitest'
import { resolveMapConfig, resolveMapProvider, type MapEnv } from './mapProvider'

const KEY = 'AIza-some-test-key'

describe('map provider resolver (issue #27)', () => {
  it('defaults to leaflet when nothing is configured', () => {
    expect(resolveMapProvider({})).toBe('leaflet')
  })

  it('reads VITE_MAP_PROVIDER=google', () => {
    expect(resolveMapProvider({ VITE_MAP_PROVIDER: 'google' })).toBe('google')
  })

  it('treats every non-google value as leaflet (fallback adapter)', () => {
    for (const provider of ['leaflet', '', 'Google', 'garbage']) {
      expect(resolveMapProvider({ VITE_MAP_PROVIDER: provider })).toBe('leaflet')
    }
  })

  it('returns the API key when provider is google', () => {
    const env: MapEnv = { VITE_MAP_PROVIDER: 'google', VITE_GOOGLE_MAPS_API_KEY: KEY }
    expect(resolveMapConfig(env)).toEqual({ provider: 'google', apiKey: KEY })
  })

  it('throws when provider is google but the API key is missing', () => {
    expect(() => resolveMapConfig({ VITE_MAP_PROVIDER: 'google' })).toThrow(
      /VITE_GOOGLE_MAPS_API_KEY/,
    )
  })

  it('throws when provider is google but the API key is empty', () => {
    expect(() =>
      resolveMapConfig({ VITE_MAP_PROVIDER: 'google', VITE_GOOGLE_MAPS_API_KEY: '' }),
    ).toThrow(/VITE_GOOGLE_MAPS_API_KEY/)
  })

  it('never demands a key from the leaflet config', () => {
    expect(resolveMapConfig({ VITE_MAP_PROVIDER: 'leaflet' })).toEqual({
      provider: 'leaflet',
    })
  })
})
