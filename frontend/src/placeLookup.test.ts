import { describe, expect, it, vi } from 'vitest'
import { fetchPlaceName } from './placeLookup'

const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4'
const container = document.createElement('div')

/** A fake google.maps.places surface: the new-API Place class (constructor
 * + fetchFields) and the legacy PlacesService (callback getDetails). */
function fakeGoogle(options: {
  noPlaceClass?: boolean
  newApiError?: Error
  newApiName?: string
  legacyName?: string
  legacyStatus?: string
} = {}) {
  const {
    noPlaceClass = false,
    newApiError = null,
    newApiName = 'Terme di Caracalla',
    legacyName = 'Terme di Caracalla',
    legacyStatus = 'OK',
  } = options
  const constructed: Array<{
    options: { id: string; requestedLanguage?: string }
    fetchFields: ReturnType<typeof vi.fn>
  }> = []
  const getDetails = vi.fn(
    (
      _request: { placeId: string; fields: string[] },
      callback: (result: { name?: string } | null, status: string) => void,
    ) => {
      callback(legacyName !== '' ? { name: legacyName } : null, legacyStatus)
    },
  )
  const Place = class {
    options: { id: string; requestedLanguage?: string }
    fetchFields: ReturnType<typeof vi.fn>
    constructor(options: { id: string; requestedLanguage?: string }) {
      this.options = options
      this.fetchFields = vi.fn(async () => {
        if (newApiError !== null) throw newApiError
        return { place: { displayName: newApiName } }
      })
      constructed.push(this)
    }
  }
  const PlacesService = class {
    getDetails = getDetails
  }
  const fake = {
    maps: {
      places: {
        ...(noPlaceClass ? {} : { Place }),
        PlacesService,
      },
    },
  }
  return {
    google: fake as unknown as typeof google,
    constructed,
    getDetails,
  }
}

describe('place name lookup for tap picks (issue #34)', () => {
  it('fetches the display name via the new Places API and returns a Place', async () => {
    const { google, constructed } = fakeGoogle()
    const place = await fetchPlaceName(PLACE_ID, google, container)
    expect(constructed[0].fetchFields).toHaveBeenCalledWith({ fields: ['displayName'] })
    expect(place).toEqual({ name: 'Terme di Caracalla', placeId: PLACE_ID })
  })

  it('constructs the Place with the place_id and the Italian language', async () => {
    const { google, constructed } = fakeGoogle()
    await fetchPlaceName(PLACE_ID, google, container)
    expect(constructed[0].options).toEqual({ id: PLACE_ID, requestedLanguage: 'it' })
  })

  it('falls back to legacy getDetails when the new API fails', async () => {
    const { google, getDetails } = fakeGoogle({ newApiError: new Error('boom') })
    const place = await fetchPlaceName(PLACE_ID, google, container)
    expect(getDetails).toHaveBeenCalledWith(
      { placeId: PLACE_ID, fields: ['name'] },
      expect.any(Function),
    )
    expect(place).toEqual({ name: 'Terme di Caracalla', placeId: PLACE_ID })
  })

  it('falls back to legacy when the new API returns no display name', async () => {
    const { google, getDetails } = fakeGoogle({ newApiName: '' })
    const place = await fetchPlaceName(PLACE_ID, google, container)
    expect(getDetails).toHaveBeenCalled()
    expect(place).toEqual({ name: 'Terme di Caracalla', placeId: PLACE_ID })
  })

  it('uses legacy getDetails when the Place class is missing', async () => {
    const { google, getDetails } = fakeGoogle({ noPlaceClass: true })
    const place = await fetchPlaceName(PLACE_ID, google, container)
    expect(getDetails).toHaveBeenCalled()
    expect(place).toEqual({ name: 'Terme di Caracalla', placeId: PLACE_ID })
  })

  it('returns null when every path fails', async () => {
    const { google } = fakeGoogle({
      newApiError: new Error('boom'),
      legacyName: '',
      legacyStatus: 'NOT_FOUND',
    })
    expect(await fetchPlaceName(PLACE_ID, google, container)).toBeNull()
  })

  it('returns null when neither API is available', async () => {
    const empty = { maps: { places: {} } } as unknown as typeof google
    expect(await fetchPlaceName(PLACE_ID, empty, container)).toBeNull()
  })
})
