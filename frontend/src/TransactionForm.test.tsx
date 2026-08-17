/** The Place reference end-to-end in the form (issue #34): a search pick
 * stores name + place_id with the Transaction; the form shows "📍 {name}"
 * instead of raw coordinates when a Place is present; and a tap re-pick, a
 * GPS pick, or Remove clears the Place. The API client and the map picker are
 * mocked; the location module is real except for getGpsPosition (device GPS
 * does not exist in jsdom). */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TransactionForm } from './TransactionForm'
import type { Category, Transaction, Wallet } from './api'
import type { LatLng, Place } from './location'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  TOKEN_KEY: 'budjetame.token',
  apiErrorMessage: () => 'Could not save the transaction.',
  formatEuros: (value: string) => `€${value}`,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

// The map picker is a separate seam (issue #27); its onPick is captured so a
// test can simulate a tap or a search pick from the map.
const picker = vi.hoisted(() => ({
  onPick: null as null | ((position: LatLng, place?: Place) => void),
}))

vi.mock('./MapPicker', () => ({
  MapPicker: ({ onPick }: { onPick: (position: LatLng, place?: Place) => void }) => {
    picker.onPick = onPick
    return <div data-testid="map-picker" />
  },
}))

// Device GPS does not exist in jsdom; the mocked lookup resolves per test.
vi.mock('./location', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./location')>()
  return { ...actual, getGpsPosition: vi.fn() }
})

import { createTransaction, updateTransaction } from './api'
import { getGpsPosition } from './location'

const createTransactionMock = vi.mocked(createTransaction)
const updateTransactionMock = vi.mocked(updateTransaction)
const getGpsPositionMock = vi.mocked(getGpsPosition)

const wallet: Wallet = {
  id: 1,
  name: 'Cash',
  type: 'cash',
  balance: '100.00',
  frozen: false,
  created_at: '2026-01-01T00:00:00Z',
}

const categories: Category[] = []

const baseTransaction: Transaction = {
  id: 7,
  type: 'expense',
  amount: '4.50',
  date: '2026-08-01',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  description: null,
  latitude: '41.9028',
  longitude: '12.4964',
  place_name: 'Esselunga',
  place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

beforeEach(() => {
  // A fresh session keeps the GPS prefill quiet: markGpsGranted from earlier
  // tests would otherwise arm it for create-form tests and consume the mock.
  sessionStorage.clear()
  picker.onPick = null
  getGpsPositionMock.mockReset()
  getGpsPositionMock.mockResolvedValue(null)
  createTransactionMock.mockReset()
  createTransactionMock.mockResolvedValue({ ...baseTransaction })
  updateTransactionMock.mockReset()
  updateTransactionMock.mockResolvedValue({ ...baseTransaction })
})

function renderForm(editing: Transaction | null) {
  return render(
    <TransactionForm
      wallets={[wallet]}
      categories={categories}
      editing={editing}
      onSaved={() => {}}
      onDeleted={() => {}}
      onCancel={() => {}}
    />,
  )
}

describe('TransactionForm place display (issue #34)', () => {
  it('shows the place name instead of coordinates when a Place is present', () => {
    renderForm(baseTransaction)

    expect(screen.getByText('📍 Esselunga')).toBeInTheDocument()
    expect(screen.queryByText('📍 41.9028, 12.4964')).not.toBeInTheDocument()
    // The link is Google's place-with-pin search URL (coordinates as the
    // query, place_id as query_place_id): the mobile Maps apps run it as a
    // search, so an unresolvable place_id still lands a pin on the spot.
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
    )
  })

  it('shows coordinates when no Place was picked (tap or GPS)', () => {
    renderForm({ ...baseTransaction, place_name: null, place_id: null })

    expect(screen.getByText('📍 41.9028, 12.4964')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=41.9028,12.4964',
    )
  })

  it('a search pick stores name + place_id and saves them with the Transaction', async () => {
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    await screen.findByTestId('map-picker')
    act(() => {
      picker.onPick!({ lat: 45.4642, lng: 9.19 }, { name: 'Duomo', placeId: 'ChIJduomo' })
    })

    expect(screen.getByText('📍 Duomo')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))

    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())
    expect(createTransactionMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        latitude: '45.4642',
        longitude: '9.19',
        place_name: 'Duomo',
        place_id: 'ChIJduomo',
      }),
    )
  })
})

describe('TransactionForm place clearing (issue #34)', () => {
  it('a tap re-pick clears the Place and saves coordinates only', async () => {
    renderForm(baseTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Change location' }))
    await screen.findByTestId('map-picker')
    // A tap reports a position with no Place.
    act(() => {
      picker.onPick!({ lat: 45, lng: 9 })
    })

    expect(screen.getByText('📍 45, 9')).toBeInTheDocument()
    expect(screen.queryByText('📍 Esselunga')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({
        latitude: '45',
        longitude: '9',
        place_name: null,
        place_id: null,
      }),
    )
  })

  it('a GPS pick clears the Place', async () => {
    getGpsPositionMock.mockResolvedValue({ lat: 44, lng: 7 })
    renderForm(baseTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    expect(await screen.findByText('📍 44, 7')).toBeInTheDocument()
    expect(screen.queryByText('📍 Esselunga')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({ place_name: null, place_id: null }),
    )
  })

  it('Remove clears the location and the Place', async () => {
    renderForm(baseTransaction)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.getByText('No location attached.')).toBeInTheDocument()
    expect(screen.queryByText('📍 Esselunga')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransactionMock).toHaveBeenCalled())
    expect(updateTransactionMock).toHaveBeenCalledWith(
      '',
      7,
      expect.objectContaining({
        latitude: null,
        longitude: null,
        place_name: null,
        place_id: null,
      }),
    )
  })
})

describe('TransactionForm GPS feedback (issue #35)', () => {
  it('disables the button with a "Locating…" label while the lookup runs, then restores', async () => {
    let resolveGps!: (position: LatLng | null) => void
    getGpsPositionMock.mockReturnValue(
      new Promise<LatLng | null>((resolve) => {
        resolveGps = resolve
      }),
    )
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    const locatingButton = screen.getByRole('button', { name: 'Locating…' })
    expect(locatingButton).toBeDisabled()

    await act(async () => {
      resolveGps({ lat: 44, lng: 7 })
    })

    // Success attaches the position as before and restores the button.
    expect(await screen.findByText('📍 44, 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled()
  })

  it('failure shows the inline message and keeps the map picker available', async () => {
    getGpsPositionMock.mockResolvedValue(null)
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    expect(
      await screen.findByText(
        "Couldn't get your location — check permissions or pick it on the map.",
      ),
    ).toBeInTheDocument()
    // The button restores so the lookup can be retried…
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled()
    // …and the map picker buttons remain available after the failure.
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }))
    expect(await screen.findByTestId('map-picker')).toBeInTheDocument()
  })

  it('a successful retry clears the failure message', async () => {
    getGpsPositionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ lat: 44, lng: 7 })
    renderForm(null)

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    await screen.findByText(
      "Couldn't get your location — check permissions or pick it on the map.",
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }))

    expect(await screen.findByText('📍 44, 7')).toBeInTheDocument()
    expect(
      screen.queryByText(
        "Couldn't get your location — check permissions or pick it on the map.",
      ),
    ).not.toBeInTheDocument()
  })
})
