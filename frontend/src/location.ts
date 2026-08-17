/** Geographic Location helpers (spec decision #11): coordinates are stored on
 * the Transaction; the Google Maps link is built here, on the frontend, and is
 * never stored as text. */

export type LatLng = { lat: number; lng: number }

/** An optional Place reference on a Geographic Location (ADR-0005): the name
 * from a name-search pick or a tap on the Google map, plus the provider's
 * reference id when it has one (e.g. a Google place_id). Only picks made on
 * the Google map produce a Place; Leaflet taps, GPS and imports attach
 * coordinates alone. */
export type Place = { name: string; placeId?: string }

/** Default map center when nothing is picked yet (Europe/Rome), shared by
 * the Leaflet and Google map pickers. */
export const DEFAULT_MAP_CENTER: LatLng = { lat: 41.9028, lng: 12.4964 }

/** The Google Maps link for a coordinate pair — built at render time, never
 * persisted (US17: "never stored as text"). A Place (ADR-0005) takes
 * precedence: place_id opens the place's info panel, else the name is
 * searched, else the bare coordinate pin. */
export function mapLink(position: LatLng, place: Place | null = null): string {
  if (place !== null && place.placeId !== undefined && place.placeId !== '') {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.placeId)}`
  }
  if (place !== null && place.name !== '') {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`
}

/** Short display form of a coordinate pair ("41.9028, 12.4964"). */
export function formatLocation(position: LatLng): string {
  return `${position.lat}, ${position.lng}`
}

/** Parse the API's coordinate strings into a position, or null when absent. */
export function latLngFromWire(
  latitude: string | null,
  longitude: string | null,
): LatLng | null {
  if (latitude === null || longitude === null) return null
  const lat = Number.parseFloat(latitude)
  const lng = Number.parseFloat(longitude)
  return Number.isNaN(lat) || Number.isNaN(lng) ? null : { lat, lng }
}

/** Serialize a position to the API's coordinate strings (null when absent). */
export function latLngToWire(
  position: LatLng | null,
): { latitude: string | null; longitude: string | null } {
  if (position === null) return { latitude: null, longitude: null }
  return { latitude: String(position.lat), longitude: String(position.lng) }
}

/** Parse the API's place fields into a Place, or null when absent. The name
 * is the anchor (ADR-0005): no name, no Place; a missing id stays a
 * name-only Place. */
export function placeFromWire(
  name: string | null,
  placeId: string | null,
): Place | null {
  if (name === null || name === '') return null
  return placeId !== null && placeId !== '' ? { name, placeId } : { name }
}

/** Serialize a Place to the API's field names (null when absent). */
export function placeToWire(
  place: Place | null,
): { place_name: string | null; place_id: string | null } {
  if (place === null) return { place_name: null, place_id: null }
  return { place_name: place.name, place_id: place.placeId ?? null }
}

/** Current position from device GPS, or null when unavailable / denied. */
export function getGpsPosition(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  })
}

/** True when the browser already granted device-location permission (so the
 * create form can prefill without prompting). */
export async function hasGpsPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.permissions === undefined) {
    return false
  }
  try {
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName,
    })
    return status.state === 'granted'
  } catch {
    return false
  }
}

const GRANTED_KEY = 'budjetame.gpsGranted'

/** Remember that device-location permission was granted this session, so the
 * prefill works even where the Permissions API can't report geolocation
 * (Safari throws for the name). */
export function markGpsGranted(): void {
  try {
    sessionStorage.setItem(GRANTED_KEY, '1')
  } catch {
    // storage unavailable (private mode): the grant just won't persist
  }
}

/** True when GPS prefill can run without prompting the user: either the
 * Permissions API reports granted, or we recorded a grant this session. */
export async function gpsPrefillAvailable(): Promise<boolean> {
  try {
    if (sessionStorage.getItem(GRANTED_KEY) === '1') return true
  } catch {
    // fall through to the permissions query
  }
  return hasGpsPermission()
}

const OPT_OUT_KEY = 'budjetame.locationOptOut'

/** Persist that the user removed a Geographic Location from a new Transaction,
 * so the GPS prefill stays off for the rest of the browser session (issue
 * #25). The tab switch unmounts the form, so the opt-out must outlive the
 * component; a fresh session clears it and the prefill returns. */
export function markLocationOptOut(): void {
  try {
    sessionStorage.setItem(OPT_OUT_KEY, '1')
  } catch {
    // storage unavailable (private mode): the opt-out just won't persist
  }
}

/** True when the user removed a location at least once this session, so the
 * create form skips the GPS prefill. Manual add paths never consult this. */
export function locationOptOutActive(): boolean {
  try {
    return sessionStorage.getItem(OPT_OUT_KEY) === '1'
  } catch {
    return false
  }
}
