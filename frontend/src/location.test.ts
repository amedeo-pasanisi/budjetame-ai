import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatLocation,
  latLngFromWire,
  latLngToWire,
  locationOptOutActive,
  mapLink,
  markLocationOptOut,
  placeFromWire,
  placeToWire,
} from './location'

describe('location helpers', () => {
  it('builds a Google Maps link from coordinates', () => {
    expect(mapLink({ lat: 41.9028, lng: 12.4964 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964',
    )
  })

  it('formats coordinates for display', () => {
    expect(formatLocation({ lat: 41.9028, lng: 12.4964 })).toBe('41.9028, 12.4964')
  })

  // The Place reference (ADR-0005): a picked Place opens via Google's
  // documented place-with-pin search URL — coordinates as the query,
  // place_id as query_place_id. The mobile apps run it as a search: a
  // place_id they can't resolve still lands a pin on the coordinates.
  it('builds the place-with-pin search URL from a Place with a place_id', () => {
    expect(
      mapLink(
        { lat: 41.9028, lng: 12.4964 },
        { name: 'Esselunga', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
      ),
    ).toBe(
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
    )
  })

  it('searches the place name when the Place has no place_id', () => {
    expect(
      mapLink({ lat: 41.9028, lng: 12.4964 }, { name: 'Esselunga Bar' }),
    ).toBe('https://www.google.com/maps/search/?api=1&query=Esselunga%20Bar')
  })

  it('uses plain coordinates when there is no Place', () => {
    expect(mapLink({ lat: 41.9028, lng: 12.4964 }, null)).toBe(
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964',
    )
  })

  it('round-trips a position through the wire format', () => {
    const position = { lat: 41.9028, lng: 12.4964 }
    const wire = latLngToWire(position)
    expect(latLngFromWire(wire.latitude, wire.longitude)).toEqual(position)
  })

  it('treats missing coordinates as no location', () => {
    expect(latLngFromWire(null, null)).toBeNull()
    expect(latLngFromWire('not-a-number', '12.4')).toBeNull()
  })
})

describe('place helpers (ADR-0005)', () => {
  it('round-trips a Place through the wire format', () => {
    const wire = placeToWire({ name: 'Esselunga', placeId: 'ChIJabc' })
    expect(wire).toEqual({ place_name: 'Esselunga', place_id: 'ChIJabc' })
    expect(placeFromWire(wire.place_name, wire.place_id)).toEqual({
      name: 'Esselunga',
      placeId: 'ChIJabc',
    })
  })

  it('keeps a Place with a name but no place_id (name-only search pick)', () => {
    expect(placeFromWire('Esselunga', null)).toEqual({ name: 'Esselunga' })
    expect(placeToWire({ name: 'Esselunga' })).toEqual({
      place_name: 'Esselunga',
      place_id: null,
    })
  })

  it('treats a missing or empty name as no Place', () => {
    expect(placeFromWire(null, 'ChIJabc')).toBeNull()
    expect(placeFromWire('', 'ChIJabc')).toBeNull()
  })

  it('clears a Place through the wire format', () => {
    expect(placeToWire(null)).toEqual({ place_name: null, place_id: null })
  })
})

// Node has no sessionStorage, so the opt-out tests run against a minimal
// in-memory shim that speaks the subset the helpers use (getItem/setItem).
const sessionStore = new Map<string, string>()

describe('location opt-out helpers (sessionStorage)', () => {
  beforeEach(() => {
    sessionStore.clear()
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (key: string) => sessionStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        sessionStore.set(key, value)
      },
    }
  })

  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })

  it('is inactive in a fresh session (prefill may run)', () => {
    expect(locationOptOutActive()).toBe(false)
  })

  it('becomes active once the user removes a location', () => {
    markLocationOptOut()
    expect(locationOptOutActive()).toBe(true)
  })

  it('stays active for the rest of the session (survives remounts)', () => {
    markLocationOptOut()
    // Any number of form mounts read the same session-scoped flag.
    expect(locationOptOutActive()).toBe(true)
    expect(locationOptOutActive()).toBe(true)
  })

  it('a fresh session (new storage) prefills again', () => {
    markLocationOptOut()
    expect(locationOptOutActive()).toBe(true)
    sessionStore.clear()
    expect(locationOptOutActive()).toBe(false)
  })

  it('degrades gracefully when sessionStorage is unavailable', () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
    expect(() => markLocationOptOut()).not.toThrow()
    expect(locationOptOutActive()).toBe(false)
  })
})
