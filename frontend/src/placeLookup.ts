/** Place-name lookup for tap picks (issue #34): clicking a place on the
 * Google map gives its place_id for free (MapMouseEvent.placeId); one
 * details call fetches the display name. New Places API first (Place
 * constructor + fetchFields), legacy PlacesService.getDetails as the
 * fallback — the same dependency the search box already uses. */

import type { Place } from './location'

/** Fetch the display name for a place_id, or null when no path yields a
 * name — the tap then stays a coordinates-only pick. */
export async function fetchPlaceName(
  placeId: string,
  googleRef: typeof google,
  container: HTMLDivElement | google.maps.Map,
): Promise<Place | null> {
  const places = googleRef.maps?.places
  if (places?.Place !== undefined) {
    try {
      // The app is single-locale (like its currency and timezone): place
      // names must come back in Italian regardless of the browser's
      // language, so the request asks for it explicitly.
      const place = new places.Place({ id: placeId, requestedLanguage: 'it' })
      const result = await place.fetchFields({ fields: ['displayName'] })
      const filled = result?.place ?? place
      // displayName is a plain string in this build (verified on library
      // 3.65), null/undefined when the name is absent or not loaded.
      if (hasName(filled.displayName)) {
        return { name: filled.displayName, placeId }
      }
    } catch {
      // fall through to the legacy path
    }
  }
  if (places?.PlacesService !== undefined) {
    try {
      const name = await new Promise<string>((resolve, reject) => {
        const service = new places.PlacesService(container)
        service.getDetails({ placeId, fields: ['name'] }, (result, status) => {
          if (status === 'OK' && hasName(result?.name)) {
            resolve(result.name)
          } else {
            reject(new Error(`getDetails failed: ${status}`))
          }
        })
      })
      return { name, placeId }
    } catch {
      return null
    }
  }
  return null
}

/** The Place contract anchors on the name: only a non-empty string is a
 * name (placeFromWire applies the same rule in location.ts). */
function hasName(name: unknown): name is string {
  return typeof name === 'string' && name !== ''
}
