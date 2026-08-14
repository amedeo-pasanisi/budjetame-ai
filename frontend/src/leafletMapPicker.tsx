import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { DEFAULT_MAP_CENTER, type LatLng } from './location'

// A text pin avoids Leaflet's default marker images (a bundler headache) and
// keeps the picker dependency-free of image assets.
const PIN_ICON = L.divIcon({
  className: '',
  html: '<span style="font-size: 28px; line-height: 32px;">📍</span>',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
})

/** The Leaflet fallback adapter (issue #27): a tap-to-pick map (OpenStreetMap
 * tiles, no API key). The chosen coordinates are reported via `onPick`; the
 * marker follows `position`. */
export function LeafletMapPicker({
  position,
  onPick,
}: {
  position: LatLng | null
  onPick: (position: LatLng) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null || mapRef.current !== null) {
      return
    }
    const map = L.map(container, {
      center: position ?? DEFAULT_MAP_CENTER,
      zoom: position === null ? 6 : 15,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map)
    const marker = L.marker(
      position ?? DEFAULT_MAP_CENTER,
      { icon: PIN_ICON },
    ).addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng })
    })
    mapRef.current = map
    markerRef.current = marker
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // The map is created once per mount; position/onPick changes are handled
    // by the effect below, so init-time values only are used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (position === null || map === null || marker === null) {
      return
    }
    marker.setLatLng([position.lat, position.lng])
    map.panTo([position.lat, position.lng])
  }, [position])

  return <div ref={containerRef} className="h-56 w-full rounded-xl" />
}
