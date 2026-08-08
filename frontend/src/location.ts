/** Geographic Location helpers (spec decision #11): coordinates are stored on
 * the Transaction; the Google Maps link is built here, on the frontend, and is
 * never stored as text. */

export type LatLng = { lat: number; lng: number }

/** The Google Maps link for a coordinate pair — built at render time, never
 * persisted (US17: "never stored as text"). */
export function mapLink(position: LatLng): string {
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
