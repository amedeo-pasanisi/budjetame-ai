/** The paged list client (issue #31): fetchTransactions hands the envelope
 * through and puts the page size and cursor on the query string. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { request } from './transport'
import {
  createTransaction,
  fetchTransactions,
  PAGE_LIMIT,
  updateTransaction,
} from './transactions'

vi.mock('./transport', () => ({
  request: vi.fn(),
}))

const requestMock = vi.mocked(request)

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response
}

const transaction = {
  id: 1,
  type: 'expense',
  amount: '4.50',
  date: '2026-08-01',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  description: 'Coffee',
  latitude: null,
  longitude: null,
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('fetchTransactions', () => {
  it('sends the page size and cursor as query parameters', async () => {
    requestMock.mockResolvedValue(
      jsonResponse({ items: [transaction], next_cursor: 'opaque-cursor' }),
    )

    await fetchTransactions('token', {}, 50, 'opaque-cursor')

    expect(requestMock).toHaveBeenCalledWith(
      '/transactions?limit=50&cursor=opaque-cursor',
      expect.objectContaining({ token: 'token' }),
    )
  })

  it('returns the envelope untouched', async () => {
    const envelope = { items: [transaction], next_cursor: null }
    requestMock.mockResolvedValue(jsonResponse(envelope))

    const page = await fetchTransactions('token')

    expect(page).toEqual(envelope)
  })

  it('defaults to the standard page size', async () => {
    requestMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))

    await fetchTransactions('token')

    expect(requestMock).toHaveBeenCalledWith(
      `/transactions?limit=${PAGE_LIMIT}`,
      expect.anything(),
    )
  })

  it('sends q on the query string when it is non-blank (ADR-0009)', async () => {
    requestMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))

    await fetchTransactions('token', { q: 'coffee', walletId: 3 })

    expect(requestMock).toHaveBeenCalledWith(
      '/transactions?wallet_id=3&q=coffee&limit=50',
      expect.anything(),
    )
  })

  it('omits q when it is blank or whitespace-only', async () => {
    requestMock.mockResolvedValue(jsonResponse({ items: [], next_cursor: null }))

    await fetchTransactions('token', { q: '' })
    await fetchTransactions('token', { q: '   ' })

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      `/transactions?limit=${PAGE_LIMIT}`,
      expect.anything(),
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      `/transactions?limit=${PAGE_LIMIT}`,
      expect.anything(),
    )
  })
})

describe('createTransaction', () => {
  it('sends the Place reference alongside the coordinates (ADR-0005)', async () => {
    requestMock.mockResolvedValue(jsonResponse(transaction))

    await createTransaction('token', {
      type: 'expense',
      amount: '4.50',
      date: '2026-08-01',
      walletId: 1,
      categoryId: null,
      description: '',
      latitude: '41.9028',
      longitude: '12.4964',
      place_name: 'Esselunga',
      place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    })

    expect(requestMock).toHaveBeenCalledWith(
      '/transactions',
      expect.objectContaining({
        method: 'POST',
        json: expect.objectContaining({
          latitude: '41.9028',
          longitude: '12.4964',
          place_name: 'Esselunga',
          place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        }),
      }),
    )
  })
})

describe('updateTransaction', () => {
  it('clears the Place when the payload carries nulls', async () => {
    requestMock.mockResolvedValue(jsonResponse(transaction))

    await updateTransaction('token', 7, {
      amount: '4.50',
      date: '2026-08-01',
      description: '',
      latitude: '41.9028',
      longitude: '12.4964',
      place_name: null,
      place_id: null,
    })

    expect(requestMock).toHaveBeenCalledWith(
      '/transactions/7',
      expect.objectContaining({
        method: 'PATCH',
        json: expect.objectContaining({ place_name: null, place_id: null }),
      }),
    )
  })
})
