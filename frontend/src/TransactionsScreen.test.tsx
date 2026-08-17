/** Transactions tab paging and filters (issues #31/#33): the first page
 * renders, the sentinel at the bottom loads the next page
 * (IntersectionObserver), pages accumulate without duplicates, any write
 * resets the list to the first page, and the merged History filters bar
 * (toggle, Frozen Wallet dropdown, refetch-on-filter) works. The API client
 * and the map picker are mocked; the real form is driven like a user would
 * (click, type, submit) for the reset-on-write path. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { TransactionsScreen } from './TransactionsScreen'
import { useImportDraft } from './importDraft'
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

/** The Import Draft lives in the app shell (issue #43); the screen takes its
 * controller as a prop. This harness owns a controller the way the shell
 * would — these tests never exercise the import flow, so it stays closed. */
function Harness() {
  const controller = useImportDraft()
  return <TransactionsScreen importState={controller} />
}

const wallet: Wallet = {
  id: 1,
  name: 'Cash',
  type: 'cash',
  balance: '100.00',
  frozen: false,
  created_at: '2026-01-01T00:00:00Z',
}

const frozenWallet: Wallet = {
  id: 2,
  name: 'Old Card',
  type: 'credit_card',
  balance: '0.00',
  frozen: true,
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
  place_name: null,
  place_id: null,
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
    render(<Harness />)

    expect(
      await screen.findByRole('heading', { name: 'All transactions' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/Coffee/)).toBeInTheDocument()
    expect(fetchTransactionsMock).toHaveBeenCalledWith('', {})
  })

  it('loads the next page when the sentinel enters the viewport, without duplicates', async () => {
    render(<Harness />)
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
    render(<Harness />)
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
    render(<Harness />)
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
    await waitFor(() => expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', {}))
    expect(await screen.findByText(/Coffee/)).toBeInTheDocument()
    expect(screen.queryByText(/Rent/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('TransactionsScreen merged filters (issue #33)', () => {
  it('keeps the filter bar closed by default and toggles it', async () => {
    render(<Harness />)

    const toggle = await screen.findByRole('button', { name: /filters/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByLabelText('Wallet')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toBeInTheDocument()
    expect(screen.getByLabelText('To')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
  })

  it('lists active and Frozen Wallets in the Wallet dropdown, marked and with balances', async () => {
    fetchWalletsMock.mockResolvedValue([wallet, frozenWallet])
    render(<Harness />)

    fireEvent.click(await screen.findByRole('button', { name: /filters/i }))
    const select = await screen.findByLabelText('Wallet')
    const options = Array.from(select.querySelectorAll('option')).map(
      (option) => option.textContent,
    )
    expect(options).toEqual([
      'All wallets',
      'Cash (€100.00)',
      'Old Card · Frozen (€0.00)',
    ])
    // Frozen Wallets are fetched explicitly so the dropdown can offer them.
    expect(fetchWalletsMock).toHaveBeenCalledWith('', true)
  })

  it('selecting a Frozen Wallet shows the read-only banner and refetches the first page with the filter applied', async () => {
    fetchWalletsMock.mockResolvedValue([wallet, frozenWallet])
    const frozenLunch = { ...baseTransaction, id: 4, wallet_id: 2, description: 'Frozen lunch' }
    fetchTransactionsMock.mockImplementation(async (_token, filters = {}) =>
      filters.walletId === 2 ? { items: [frozenLunch], next_cursor: null } : page1,
    )
    render(<Harness />)
    await screen.findByText(/Coffee/)

    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(await screen.findByLabelText('Wallet'), { target: { value: '2' } })

    expect(
      await screen.findByText('This wallet is frozen — its history is viewable but read-only.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 2 }),
    )
    // First page reset: the unfiltered row is gone, the filtered one shown.
    expect(await screen.findByText(/Frozen lunch/)).toBeInTheDocument()
    expect(screen.queryByText(/Coffee/)).not.toBeInTheDocument()
  })

  it('changing a date filter refetches with it and shows the filtered empty state', async () => {
    fetchTransactionsMock.mockImplementation(async (_token, filters = {}) =>
      filters.fromDate === '2026-01-01' ? { items: [], next_cursor: null } : page1,
    )
    render(<Harness />)
    await screen.findByText(/Coffee/)

    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-01-01' } })

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { fromDate: '2026-01-01' }),
    )
    expect(
      await screen.findByText('No transactions match these filters.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Coffee/)).not.toBeInTheDocument()
  })

  it('resets filters when the screen unmounts (a tab switch)', async () => {
    fetchWalletsMock.mockResolvedValue([wallet, frozenWallet])
    const { unmount } = render(<Harness />)
    await screen.findByText(/Coffee/)
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(await screen.findByLabelText('Wallet'), { target: { value: '2' } })
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 2 }),
    )

    unmount()
    fetchTransactionsMock.mockClear()
    render(<Harness />)

    await screen.findByText(/Coffee/)
    // Fresh mount: bar closed, no wallet selected, unfiltered first page.
    expect(screen.getByRole('button', { name: /filters/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()
    expect(fetchTransactionsMock).toHaveBeenCalledWith('', {})
  })
})
