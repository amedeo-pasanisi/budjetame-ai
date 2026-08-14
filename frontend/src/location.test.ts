import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatLocation,
  latLngFromWire,
  latLngToWire,
  locationOptOutActive,
  mapLink,
  markLocationOptOut,
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
