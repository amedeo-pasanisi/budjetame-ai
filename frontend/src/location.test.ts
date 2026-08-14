import { describe, expect, it } from 'vitest'
import { formatLocation, latLngFromWire, latLngToWire, mapLink } from './location'

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
