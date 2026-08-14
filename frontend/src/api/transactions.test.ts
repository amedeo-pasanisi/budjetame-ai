/** The paged list client (issue #31): fetchTransactions hands the envelope
 * through and puts the page size and cursor on the query string; the History
 * screen's fetchAllTransactions walks every page until the cursor runs out. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { request } from './transport'
import { fetchAllTransactions, fetchTransactions, PAGE_LIMIT } from './transactions'

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
})

describe('fetchAllTransactions', () => {
  it('walks every page until the cursor runs out', async () => {
    requestMock
      .mockResolvedValueOnce(jsonResponse({ items: [transaction], next_cursor: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ ...transaction, id: 2 }], next_cursor: null }))

    const all = await fetchAllTransactions('token')

    expect(all.map((t) => t.id)).toEqual([1, 2])
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      '/transactions?limit=50&cursor=c1',
      expect.anything(),
    )
  })
})
