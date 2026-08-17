import { useEffect, useRef, useState } from 'react'

import { fetchPlaceName } from './placeLookup'
import { DEFAULT_MAP_CENTER, type LatLng, type Place } from './location'

/** The Google Maps adapter (issue #27): a real Google Map with Places
 * autocomplete search. Implements the same `{ position, onPick }` contract as
 * the Leaflet picker; search richness lives here, not in the interface.

 * The Maps JavaScript API script loads dynamically, and only when this
 * component mounts — which the MapPicker dispatcher only does when
 * `VITE_MAP_PROVIDER=google` is configured.
 */

/** One dynamic script load per API key, shared across mounts. */
const scriptPromises = new Map<string, Promise<void>>()

declare global {
  interface Window {
    __budjetameMapsReady?: () => void
  }
}

/** Load the Maps JavaScript API (with Places) once per key. Resolves when the
 * script's bootstrap callback fires; rejects on load failure or timeout. */
function loadGoogleMaps(apiKey: string): Promise<void> {
  const cached = scriptPromises.get(apiKey)
  if (cached !== undefined) return cached

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-budjetame-google-maps]')
    if (existing !== null) {
      resolve()
      return
    }
    const timeout = window.setTimeout(() => {
      delete window.__budjetameMapsReady
      reject(new Error('Timed out loading Google Maps (ad-blocker or network?).'))
    }, 15000)
    window.__budjetameMapsReady = () => {
      window.clearTimeout(timeout)
      delete window.__budjetameMapsReady
      resolve()
    }
    const script = document.createElement('script')
    script.dataset.budjetameGoogleMaps = 'true'
    script.async = true
    // language=it keeps place names and autocomplete suggestions in Italian,
    // independent of the browser's language (issue #34).
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(apiKey)}` +
      '&libraries=places&language=it&v=weekly&loading=async&callback=__budjetameMapsReady'
    script.onerror = () => {
      window.clearTimeout(timeout)
      delete window.__budjetameMapsReady
      reject(new Error('Google Maps script failed to load.'))
    }
    document.head.appendChild(script)
  })
  scriptPromises.set(apiKey, promise)
  return promise
}

/** A tap-to-pick Google Map with a Places autocomplete search box. The chosen
 * coordinates are reported via `onPick`; a search pick and a tap on a place
 * (POI) both report the Place's name and place_id (ADR-0005), a bare-map
 * tap reports coordinates alone. The marker follows `position`. */

/** The map click event, with the POI place_id the runtime provides: clicking
 * a place on the map fires a click carrying its place_id (verified on
 * library 3.65), but @types/google.maps lags the runtime and does not
 * declare it on MapMouseEvent. */
type TapClickEvent = google.maps.MapMouseEvent & { placeId?: string | null }

export function GoogleMapPicker({
  apiKey,
  position,
  onPick,
}: {
  apiKey: string
  position: LatLng | null
  onPick: (position: LatLng, place?: Place) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  // Every pick (tap or search) bumps this token, so only the most recent
  // pick may call onPick — a stale tap lookup can never overwrite a newer
  // pick or one that was cancelled by unmounting the picker.
  const pickTokenRef = useRef(0)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // True while a tap's place name is being fetched (issue #34): the map is
  // covered with "Looking up…" so the lookup is visible to the user.
  const [lookingUp, setLookingUp] = useState(false)

  useEffect(() => {
    let cancelled = false
    let map: google.maps.Map | null = null
    let autocomplete: google.maps.places.Autocomplete | null = null
    setLoading(true)
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled) return
        const container = containerRef.current
        const search = searchRef.current
        if (container === null || search === null) return
        map = new google.maps.Map(container, {
          center: position ?? DEFAULT_MAP_CENTER,
          zoom: position === null ? 6 : 15,
        })
        mapRef.current = map
        markerRef.current = new google.maps.Marker({
          map,
          position: position ?? DEFAULT_MAP_CENTER,
        })
        map.addListener('click', (event: TapClickEvent) => {
          const latLng = event.latLng
          if (latLng === null) return
          const position = { lat: latLng.lat(), lng: latLng.lng() }
          const pickToken = ++pickTokenRef.current
          const placeId = event.placeId ?? null
          if (placeId === null) {
            // Bare-map tap: coordinates-only pick (clears any stored Place).
            onPickRef.current(position)
            return
          }
          // Tap on a place (issue #34): the place_id comes free with the
          // click; fetch the name while the "Looking up…" cover hides
          // Google's default place card (it cannot be suppressed).
          void (async () => {
            setLookingUp(true)
            try {
              const place = await fetchPlaceName(placeId, google, container)
              if (cancelled || pickToken !== pickTokenRef.current) return
              onPickRef.current(position, place ?? undefined)
            } finally {
              if (!cancelled && pickToken === pickTokenRef.current) {
                setLookingUp(false)
              }
            }
          })()
        })
        // Place-name search with autocomplete (user story 12): the search
        // requests name and place_id alongside the geometry, so a search pick
        // can report the Place with the coordinates (ADR-0005).
        autocomplete = new google.maps.places.Autocomplete(search, {
          fields: ['geometry', 'name', 'place_id'],
        })
        autocomplete.addListener('place_changed', () => {
          const selected = autocomplete?.getPlace()
          const location = selected?.geometry?.location
          if (selected === undefined || location === undefined) return
          map?.panTo(location)
          map?.setZoom(15)
          const place: Place | undefined =
            selected.name !== undefined &&
            selected.name !== '' &&
            selected.place_id !== undefined &&
            selected.place_id !== ''
              ? { name: selected.name, placeId: selected.place_id }
              : undefined
          pickTokenRef.current += 1 // invalidate any in-flight tap lookup
          onPickRef.current(
            { lat: location.lat(), lng: location.lng() },
            place,
          )
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Google Maps failed to load.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      if (autocomplete !== null) {
        google.maps.event.clearInstanceListeners(autocomplete)
      }
      mapRef.current = null
      markerRef.current = null
    }
    // The map is created once per mount; position/onPick changes are handled
    // by the effect below, so init-time values only are used here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (position === null || map === null || marker === null) return
    marker.setPosition(position)
    map.panTo(position)
  }, [position])

  if (loadError !== null) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
        Google Maps failed to load: {loadError} You can switch the picker back
        to the free Leaflet map with <code>VITE_MAP_PROVIDER=leaflet</code>.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <input
        ref={searchRef}
        type="text"
        placeholder="Search for a place…"
        disabled={loading || lookingUp}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
      />
      {loading && (
        <p className="text-xs text-slate-500">Loading Google Map…</p>
      )}
      <div className="relative">
        <div
          ref={containerRef}
          className="h-56 w-full overflow-hidden rounded-xl"
        />
        {lookingUp && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/90 text-sm text-slate-600">
            Looking up…
          </div>
        )}
      </div>
    </div>
  )
}
