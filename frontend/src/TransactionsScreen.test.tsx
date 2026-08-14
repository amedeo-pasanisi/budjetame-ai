/** Transactions tab paging (issue #31): the first page renders, the sentinel
 * at the bottom loads the next page (IntersectionObserver), pages accumulate
 * without duplicates, and any write resets the list to the first page. The
 * API client and the map picker are mocked; the real form is driven like a
 * user would (click, type, submit) for the reset-on-write path. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TransactionsScreen } from './TransactionsScreen'
import type { Transaction, TransactionPage, Wallet } from './api'

vi.mock('./api', () => ({
  TOKEN_KEY: 'budjetame.token',
  PAGE_LIMIT: 50,
  formatEuros: (value: string) => `€${value}`,
  fetchWallets: vi.fn(),
  fetchCategories: vi.fn(),
  fetchTransactions: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

// The map picker is a separate seam (issue #27); this test is about paging.
vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import {
  createTransaction,
  fetchCategories,
  fetchTransactions,
  fetchWallets,
} from './api'

/** jsdom has no IntersectionObserver; a fake records instances so a test can
 * simulate the sentinel entering the viewport. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  /** Simulate the sentinel becoming visible. */
  enter(): void {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

const wallet: Wallet = {
  id: 1,
  name: 'Cash',
  type: 'cash',
  balance: '100.00',
  frozen: false,
  created_at: '2026-01-01T00:00:00Z',
}

const baseTransaction: Transaction = {
  id: 1,
  type: 'expense',
  amount: '4.50',
  date: '2026-08-01',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  description: null,
  latitude: null,
  longitude: null,
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

const coffee = { ...baseTransaction, id: 1, description: 'Coffee' }
const rent = { ...baseTransaction, id: 2, description: 'Rent', amount: '600.00' }
const newCoffee = { ...coffee, id: 3, description: 'New coffee', amount: '5.00' }

const page1: TransactionPage = { items: [coffee], next_cursor: 'c1' }
const page2: TransactionPage = { items: [rent], next_cursor: null }

const fetchTransactionsMock = vi.mocked(fetchTransactions)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const createTransactionMock = vi.mocked(createTransaction)

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  fetchWalletsMock.mockResolvedValue([wallet])
  fetchCategoriesMock.mockResolvedValue([])
  fetchTransactionsMock.mockImplementation(async (_token, _filters, _limit, cursor) =>
    cursor === 'c1' ? page2 : page1,
  )
  createTransactionMock.mockResolvedValue(newCoffee)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('TransactionsScreen infinite scroll', () => {
  it('renders the first page under the "All transactions" heading', async () => {
    render(<TransactionsScreen />)

    expect(
      await screen.findByRole('heading', { name: 'All transactions' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/Coffee/)).toBeInTheDocument()
    expect(fetchTransactionsMock).toHaveBeenCalledWith('')
  })

  it('loads the next page when the sentinel enters the viewport, without duplicates', async () => {
    render(<TransactionsScreen />)
    await screen.findByText(/Coffee/)

    act(() => FakeIntersectionObserver.instances.at(-1)!.enter())

    expect(await screen.findByText(/Rent/)).toBeInTheDocument()
    expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', {}, 50, 'c1')
    // Both pages are present, each row exactly once.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByText(/Coffee/)).toHaveLength(1)
    expect(screen.getAllByText(/Rent/)).toHaveLength(1)
  })

  it('does not fetch further pages once the last page is reached', async () => {
    render(<TransactionsScreen />)
    await screen.findByText(/Coffee/)

    act(() => FakeIntersectionObserver.instances.at(-1)!.enter())
    await screen.findByText(/Rent/)

    const callsAfterLastPage = fetchTransactionsMock.mock.calls.length
    // The sentinel is gone (next_cursor is null), so nothing can re-trigger.
    act(() => {
      for (const observer of FakeIntersectionObserver.instances) observer.enter()
    })
    expect(fetchTransactionsMock.mock.calls.length).toBe(callsAfterLastPage)
  })

  it('resets to the first page after saving a transaction', async () => {
    render(<TransactionsScreen />)
    await screen.findByText(/Coffee/)
    act(() => FakeIntersectionObserver.instances.at(-1)!.enter())
    await screen.findByText(/Rent/)

    // Save a new transaction through the real modal.
    fireEvent.click(screen.getByRole('button', { name: 'New transaction' }))
    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))
    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())

    // The list reloads from the first page: the accumulated page 2 is gone
    // (the reload call carries no cursor).
    await waitFor(() => expect(fetchTransactionsMock).toHaveBeenLastCalledWith(''))
    expect(await screen.findByText(/Coffee/)).toBeInTheDocument()
    expect(screen.queryByText(/Rent/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})
