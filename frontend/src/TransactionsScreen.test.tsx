/** Transactions tab paging and filters (issues #31/#33): the first page
 * renders, the sentinel at the bottom loads the next page
 * (IntersectionObserver), pages accumulate without duplicates, any write
 * resets the list to the first page, and the merged History filters bar
 * (toggle, Frozen Wallet dropdown, refetch-on-filter) works. The API client
 * and the map picker are mocked; the real form is driven like a user would
 * (click, type, submit) for the reset-on-write path. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { TransactionsScreen } from './TransactionsScreen'
import { useImportDraft } from './importDraft'
import type {
  Category,
  RecurringCost,
  RecurringIncome,
  Transaction,
  TransactionPage,
  Wallet,
} from './api'

vi.mock('./api', () => {
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    ApiError,
    TOKEN_KEY: 'budjetame.token',
    PAGE_LIMIT: 50,
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError
        ? error.status === 409
          ? conflict
          : fallback
        : fallback,
    formatEuros: (value: string) => `€${value}`,
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
    fetchRecurringCosts: vi.fn(),
    fetchRecurringIncomes: vi.fn(),
    fetchTransactions: vi.fn(),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    exportTransactions: vi.fn(),
    createCategory: vi.fn(),
    createWallet: vi.fn(),
    createRecurringCost: vi.fn(),
    createRecurringIncome: vi.fn(),
  }
})

// The map picker is a separate seam (issue #27); this test is about paging.
vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import {
  ApiError,
  createCategory,
  createRecurringCost,
  createRecurringIncome,
  createTransaction,
  createWallet,
  deleteTransaction,
  exportTransactions,
  fetchCategories,
  fetchRecurringCosts,
  fetchRecurringIncomes,
  fetchTransactions,
  fetchWallets,
  updateTransaction,
} from './api'
import { SENTINEL_VALUE } from './EntitySelect'

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

// The sentinel's observer is created in a passive effect that React can
// flush after the test's afterEach has run (its scheduler defers effect
// flushes to a macrotask). Stubbing and un-stubbing per test left a gap
// where a late flush ran with the global restored to undefined — the flaky
// "IntersectionObserver is not defined" from a passing test's teardown.
// jsdom has no real IntersectionObserver and nothing in this file needs
// the global to be absent, so the fake is installed for the whole file and
// never uninstalled; each test still starts with an empty instance list.
beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

/** The sentinel's observer is created in a passive effect that React can
 * flush after the visible commit (its scheduler defers effect flushes to a
 * macrotask), so it may not exist right after the rows render. Wait for the
 * fake to record the current mount's observer, then simulate the sentinel
 * entering the viewport. */
async function enterSentinel(): Promise<void> {
  await waitFor(() => {
    expect(FakeIntersectionObserver.instances.length).toBeGreaterThan(0)
  })
  act(() => FakeIntersectionObserver.instances.at(-1)!.enter())
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

// A Contact Wallet (CONTEXT.md): only Transfers move money through it, so
// the Expense/Income Wallet select never lists it — but the Transfer's
// From/To selects do, and inline creation from a Transfer must allow the
// Contact type.
const marcoWallet: Wallet = {
  id: 4,
  name: 'Marco',
  type: 'contact',
  balance: '0.00',
  frozen: false,
  created_at: '2026-01-01T00:00:00Z',
}

const foodCategory: Category = {
  id: 1,
  name: 'Food',
  type: 'expense',
  icon: null,
  color: '#000000',
  created_at: '2026-01-01T00:00:00Z',
}

const salaryCategory: Category = {
  id: 2,
  name: 'Salary',
  type: 'income',
  icon: null,
  color: '#000000',
  created_at: '2026-01-01T00:00:00Z',
}

const groceryCategory: Category = {
  id: 5,
  name: 'Groceries',
  type: 'expense',
  icon: null,
  color: '#ef4444',
  created_at: '2026-01-01T00:00:00Z',
}

const freelanceCategory: Category = {
  id: 6,
  name: 'Freelance',
  type: 'income',
  icon: null,
  color: '#ef4444',
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
  recurring_cost_id: null,
  recurring_income_id: null,
  occurrence_date: null,
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
// An Income Transaction for the edit-mode sentinel coverage: the Category
// sentinel must ride the Income form too, with Income locked (ADR-0013).
const salary = { ...baseTransaction, id: 7, type: 'income', description: 'Salary' } as Transaction

// A Recurring Cost for the inline-creation coverage (issue #73): a fresh
// definition with no start date is due today, so its oldest Unpaid
// Occurrence — what a new linked Expense pays — is today.
const rentCost: RecurringCost = {
  id: 11,
  name: 'Rent',
  amount: '850.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: null,
  due_day: null,
  due_month: null,
  next_due_date: '2026-08-01',
  next_unpaid_occurrence_date: '2026-08-01',
  backlog_count: 0,
  overdue: false,
  created_at: '2026-08-01T10:00:00Z',
}

// The Recurring Income mirror (issue #73): same shape, income side.
const salaryIncome: RecurringIncome = {
  id: 12,
  name: 'Salary',
  amount: '2100.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: null,
  due_day: null,
  due_month: null,
  next_due_date: '2026-08-01',
  next_unpaid_occurrence_date: '2026-08-01',
  backlog_count: 0,
  overdue: false,
  created_at: '2026-08-01T10:00:00Z',
}

const page1: TransactionPage = { items: [coffee], next_cursor: 'c1' }
const page2: TransactionPage = { items: [rent], next_cursor: null }

const fetchTransactionsMock = vi.mocked(fetchTransactions)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)
const createTransactionMock = vi.mocked(createTransaction)
const updateTransactionMock = vi.mocked(updateTransaction)
const deleteTransactionMock = vi.mocked(deleteTransaction)
const createCategoryMock = vi.mocked(createCategory)
const createWalletMock = vi.mocked(createWallet)
const createRecurringCostMock = vi.mocked(createRecurringCost)
const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const exportTransactionsMock = vi.mocked(exportTransactions)

beforeEach(() => {
  FakeIntersectionObserver.instances = []
  fetchWalletsMock.mockResolvedValue([wallet])
  fetchCategoriesMock.mockResolvedValue([])
  fetchRecurringCostsMock.mockResolvedValue([])
  fetchRecurringIncomesMock.mockResolvedValue([])
  fetchTransactionsMock.mockImplementation(async (_token, _filters, _limit, cursor) =>
    cursor === 'c1' ? page2 : page1,
  )
  createTransactionMock.mockResolvedValue(newCoffee)
  updateTransactionMock.mockResolvedValue(newCoffee)
  createCategoryMock.mockResolvedValue(groceryCategory)
  createWalletMock.mockResolvedValue({
    id: 7,
    name: 'Revolut',
    type: 'checking',
    balance: '0.00',
    frozen: false,
    created_at: '2026-01-01T00:00:00Z',
  })
  createRecurringCostMock.mockResolvedValue(rentCost)
  createRecurringIncomeMock.mockResolvedValue(salaryIncome)
  deleteTransactionMock.mockResolvedValue({ warning: false })
  exportTransactionsMock.mockResolvedValue({
    blob: new Blob(['xlsx']),
    filename: 'budjetame-2026-08-23.xlsx',
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TransactionsScreen row title (description-led)', () => {
  it('leads with the Category, then the Description, and keeps the type word as the fallback', async () => {
    fetchCategoriesMock.mockResolvedValue([foodCategory])
    fetchTransactionsMock.mockImplementation(async () => ({
      items: [{ ...coffee, category_id: 1 }, { ...baseTransaction, id: 2 }],
      next_cursor: null,
    }))
    render(<Harness />)

    // Category leads, the whole Description follows on the bold line.
    expect(await screen.findByText('Food · Coffee')).toBeInTheDocument()
    // Neither Category nor Description: the type word survives.
    expect(await screen.findByText('Expense')).toBeInTheDocument()
    // The Description no longer repeats in the subtitle line.
    expect(screen.getAllByText(/Coffee/)).toHaveLength(1)
  })
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

    await enterSentinel()

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

    await enterSentinel()
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
    await enterSentinel()
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

describe('TransactionsScreen search (issue #54)', () => {
  const typeSearch = async (value: string) => {
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search transactions' }),
      { target: { value } },
    )
  }

  /** Fake timers scoped to setTimeout/clearTimeout only, so promises and
   * React's scheduler keep running normally. */
  const debounce = async () => {
    act(() => {
      vi.advanceTimersByTime(300)
    })
  }

  const withFakeTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

  it('renders the search bar under the header row', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const search = screen.getByRole('searchbox', { name: 'Search transactions' })
    const header = screen.getByRole('heading', { name: 'All transactions' })
    const list = screen.getByRole('list')
    expect(
      header.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      search.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('hides the search bar when the ledger is truly empty', async () => {
    fetchTransactionsMock.mockImplementation(async () => ({
      items: [],
      next_cursor: null,
    }))
    render(<Harness />)

    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
    expect(
      screen.queryByRole('searchbox', { name: 'Search transactions' }),
    ).not.toBeInTheDocument()
  })

  it('debounces typing into a first-page refetch with q', async () => {
    fetchTransactionsMock.mockImplementation(async (_token, filters = {}) =>
      filters.q === 'caffe'
        ? { items: [newCoffee], next_cursor: null }
        : page1,
    )
    render(<Harness />)
    await screen.findByText(/Coffee/)

    withFakeTimers()
    await typeSearch('caf')
    await typeSearch('caffe')
    // Two keystrokes, one debounce window: nothing refetches yet.
    expect(fetchTransactionsMock).toHaveBeenCalledTimes(1)
    await debounce()
    vi.useRealTimers()

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', { q: 'caffe' }),
    )
    expect(fetchTransactionsMock).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/New coffee/)).toBeInTheDocument()
    expect(screen.queryByText(/Coffee/)).not.toBeInTheDocument()
  })

  it('keeps loading further pages within the search results', async () => {
    const secondCoffee = { ...baseTransaction, id: 6, description: 'Coffee two' }
    fetchTransactionsMock.mockImplementation(async (_token, filters = {}, _limit, cursor) => {
      if (filters.q !== 'coffee') {
        return page1
      }
      return cursor === 'c1'
        ? { items: [secondCoffee], next_cursor: null }
        : { items: [coffee], next_cursor: 'c1' }
    })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    withFakeTimers()
    await typeSearch('coffee')
    await debounce()
    vi.useRealTimers()
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { q: 'coffee' }),
    )

    await enterSentinel()

    expect(await screen.findByText(/Coffee two/)).toBeInTheDocument()
    // The next page is fetched with the search applied alongside the cursor.
    expect(fetchTransactionsMock).toHaveBeenLastCalledWith(
      '',
      { q: 'coffee' },
      50,
      'c1',
    )
    // Both pages of the search results are listed; nothing outside the
    // search leaks in (the unfiltered page-2 row is "Rent").
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText(/Rent/)).not.toBeInTheDocument()
  })

  it('shows the no-match message when nothing matches', async () => {
    fetchTransactionsMock.mockImplementation(async (_token, filters = {}) =>
      filters.q === 'zzz' ? { items: [], next_cursor: null } : page1,
    )
    render(<Harness />)
    await screen.findByText(/Coffee/)

    withFakeTimers()
    await typeSearch('zzz')
    await debounce()
    vi.useRealTimers()

    expect(
      await screen.findByText('No transactions match your search.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Coffee/)).not.toBeInTheDocument()
  })

  it('combines with the Filters bar and clearing restores the full list', async () => {
    const frozenCoffee = {
      ...baseTransaction,
      id: 4,
      wallet_id: 2,
      description: 'Frozen coffee',
    }
    const frozenLunch = {
      ...baseTransaction,
      id: 5,
      wallet_id: 2,
      description: 'Frozen lunch',
    }
    fetchWalletsMock.mockResolvedValue([wallet, frozenWallet])
    fetchTransactionsMock.mockImplementation(async (_token, filters = {}) => {
      if (filters.walletId === 2 && filters.q === 'coffee') {
        return { items: [frozenCoffee], next_cursor: null }
      }
      if (filters.walletId === 2) {
        return { items: [frozenLunch], next_cursor: null }
      }
      return page1
    })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(await screen.findByLabelText('Wallet'), { target: { value: '2' } })
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 2 }),
    )
    await screen.findByText(/Frozen lunch/)

    // Searching narrows the already-filtered list: both travel together.
    withFakeTimers()
    await typeSearch('coffee')
    await debounce()
    vi.useRealTimers()

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', {
        walletId: 2,
        q: 'coffee',
      }),
    )
    expect(await screen.findByText(/Frozen coffee/)).toBeInTheDocument()
    expect(screen.queryByText(/Frozen lunch/)).not.toBeInTheDocument()

    // Clearing the search restores the filtered list, not the whole ledger.
    withFakeTimers()
    await typeSearch('')
    await debounce()
    vi.useRealTimers()

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', { walletId: 2 }),
    )
    expect(await screen.findByText(/Frozen lunch/)).toBeInTheDocument()

    // Clearing the filter restores the full ledger.
    fireEvent.change(screen.getByLabelText('Wallet'), { target: { value: '' } })
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', {}),
    )
    expect(await screen.findByText(/Coffee/)).toBeInTheDocument()
  })

  it('resets the search when the screen unmounts (a tab switch)', async () => {
    const { unmount } = render(<Harness />)
    await screen.findByText(/Coffee/)
    withFakeTimers()
    await typeSearch('coffee')
    await debounce()
    vi.useRealTimers()
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { q: 'coffee' }),
    )

    unmount()
    fetchTransactionsMock.mockClear()
    render(<Harness />)

    await screen.findByText(/Coffee/)
    expect(
      screen.getByRole('searchbox', { name: 'Search transactions' }),
    ).toHaveValue('')
    expect(fetchTransactionsMock).toHaveBeenCalledWith('', {})
  })

  it('refreshes with the search applied after saving a transaction', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)
    withFakeTimers()
    await typeSearch('coffee')
    await debounce()
    vi.useRealTimers()
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { q: 'coffee' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'New transaction' }))
    fireEvent.change(screen.getByLabelText('Amount (€)'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save transaction' }))
    await waitFor(() => expect(createTransactionMock).toHaveBeenCalled())

    // The post-write refresh carries the search, so the list never goes stale.
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', { q: 'coffee' }),
    )
  })

  it('refreshes with the search applied after deleting a transaction', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)
    withFakeTimers()
    await typeSearch('coffee')
    await debounce()
    vi.useRealTimers()
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { q: 'coffee' }),
    )

    fireEvent.click(screen.getByText('Coffee'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete transaction' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }))
    await waitFor(() => expect(deleteTransactionMock).toHaveBeenCalled())

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenLastCalledWith('', { q: 'coffee' }),
    )
  })
})

describe('TransactionsScreen inline category creation (ADR-0013)', () => {
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New transaction' }))
    return await screen.findByRole('dialog', { name: 'New transaction' })
  }

  /** The Category select's options, in order. */
  const categoryOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog)
        .getByLabelText('Category')
        .querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option, after None, in create and edit modes, for Expense and Income', async () => {
    fetchCategoriesMock.mockResolvedValue([foodCategory, salaryCategory])
    fetchTransactionsMock.mockImplementation(async () => ({
      items: [coffee, salary],
      next_cursor: null,
    }))
    render(<Harness />)
    await screen.findByText(/Coffee/)

    // Create mode, Expense (the default type): the sentinel sits last.
    const dialog = await openCreateForm()
    expect(categoryOptions(dialog)).toEqual(['None', 'Food', '＋ Add category…'])

    // Switching to Income filters to income Categories; the sentinel stays last.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    expect(categoryOptions(dialog)).toEqual(['None', 'Salary', '＋ Add category…'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Edit mode carries the same sentinel, for both kinds of Transaction.
    fireEvent.click(screen.getByText('Coffee'))
    let editDialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    expect(categoryOptions(editDialog)).toEqual(['None', 'Food', '＋ Add category…'])
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('Salary'))
    editDialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    expect(categoryOptions(editDialog)).toEqual(['None', 'Salary', '＋ Add category…'])
  })

  it('picking the sentinel opens the New category modal locked to the current type and reverts the dropdown', async () => {
    fetchCategoriesMock.mockResolvedValue([foodCategory, salaryCategory])
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    const categorySelect = within(dialog).getByLabelText('Category')
    // A real selection first, so the revert is observable.
    fireEvent.change(categorySelect, { target: { value: '1' } })
    expect(categorySelect).toHaveValue('1')

    // Expense (the default): the Type selector is hidden and the type fixed.
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    let categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    expect(within(categoryDialog).queryByLabelText('Type')).not.toBeInTheDocument()
    expect(
      within(categoryDialog).getByText('Expense · fixed for this form'),
    ).toBeInTheDocument()
    // The dropdown reverted to its previous value; the outer draft is intact.
    expect(categorySelect).toHaveValue('1')
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(null)

    // The lock follows the type: switch to Income and re-pick.
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    expect(
      within(categoryDialog).getByText('Income · fixed for this form'),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(null)
  })

  it('the full flow — sentinel, create, auto-select, submit — carries the new category id', async () => {
    fetchCategoriesMock.mockResolvedValue([foodCategory])
    createCategoryMock.mockResolvedValue(groceryCategory)
    createTransactionMock.mockResolvedValue({ ...newCoffee, category_id: 5 })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '12.50' },
    })

    const categorySelect = within(dialog).getByLabelText('Category')
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Groceries' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    // The Category is created with the locked Expense type.
    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith('', {
        name: 'Groceries',
        type: 'expense',
        icon: '',
        color: '#ef4444',
      }),
    )
    // Only the inner modal closes; the form and its draft survive.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(12.5)
    // The new Category is selected and offered in the dropdown.
    await waitFor(() => expect(categorySelect).toHaveValue('5'))
    expect(categoryOptions(dialog)).toEqual([
      'None',
      'Food',
      'Groceries',
      '＋ Add category…',
    ])
    expect(createTransactionMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new Category's id.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    await waitFor(() =>
      expect(createTransactionMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ categoryId: 5 }),
      ),
    )
  })

  it('an Income transaction creates an Income category inline and carries its id', async () => {
    createCategoryMock.mockResolvedValue(freelanceCategory)
    createTransactionMock.mockResolvedValue({
      ...newCoffee,
      type: 'income',
      category_id: 6,
    })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '200.00' },
    })

    const categorySelect = within(dialog).getByLabelText('Category')
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Freelance' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    // Created with the locked Income type.
    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith('', {
        name: 'Freelance',
        type: 'income',
        icon: '',
        color: '#ef4444',
      }),
    )
    // Auto-selected in the form; the Income draft survives.
    await waitFor(() => expect(categorySelect).toHaveValue('6'))
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(200)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    await waitFor(() =>
      expect(createTransactionMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ type: 'income', categoryId: 6 }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the category modal and leave the form draft intact', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '9.99' },
    })

    // Opens the stacked Category modal on top of the open form.
    const openCategoryModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Category'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New category' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(9.99)
    }

    // Cancel closes only the inner modal.
    let categoryDialog = await openCategoryModal()
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // Backdrop tap closes only the inner modal.
    categoryDialog = await openCategoryModal()
    fireEvent.click(categoryDialog.previousElementSibling as Element)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // One Escape closes only the topmost modal; a second closes the form.
    categoryDialog = await openCategoryModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    formSurvives()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createCategoryMock).not.toHaveBeenCalled()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('a duplicate category name shows the validation error inside the modal and selects nothing', async () => {
    fetchCategoriesMock.mockResolvedValue([foodCategory])
    createCategoryMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    const categorySelect = within(dialog).getByLabelText('Category')
    fireEvent.change(categorySelect, { target: { value: '1' } })
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Food' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    expect(
      await within(categoryDialog).findByText('A category with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open and nothing is selected; the outer draft is intact.
    expect(screen.getByRole('dialog', { name: 'New category' })).toBeInTheDocument()
    expect(categorySelect).toHaveValue('1')

    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('the Transfer form shows no Category field and no sentinel', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }))
    expect(within(dialog).queryByLabelText('Category')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('＋ Add category…')).not.toBeInTheDocument()
  })

  it('works in edit mode: the inline Category is auto-selected and the edit carries its id', async () => {
    createCategoryMock.mockResolvedValue(groceryCategory)
    updateTransactionMock.mockResolvedValue({ ...baseTransaction, category_id: 5 })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    fireEvent.click(screen.getByText('Coffee'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    const categorySelect = within(dialog).getByLabelText('Category')
    expect(categorySelect).toHaveValue('')

    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    expect(
      within(categoryDialog).getByText('Expense · fixed for this form'),
    ).toBeInTheDocument()
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Groceries' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    // Auto-selected in the open edit form, nothing else touched.
    await waitFor(() => expect(categorySelect).toHaveValue('5'))
    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateTransactionMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ categoryId: 5 }),
      ),
    )
  })
})

describe('TransactionsScreen inline wallet creation (issue #72)', () => {
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New transaction' }))
    return await screen.findByRole('dialog', { name: 'New transaction' })
  }

  /** The single Wallet select's options, in order. */
  const walletOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Wallet').querySelectorAll('option'),
    ).map((option) => option.textContent)

  /** A Transfer's From/To select options, in order. */
  const transferOptions = (dialog: HTMLElement, label: string) =>
    Array.from(
      within(dialog).getByLabelText(label).querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option in the Expense/Income Wallet select, in create and edit modes', async () => {
    fetchWalletsMock.mockResolvedValue([wallet, frozenWallet])
    render(<Harness />)
    await screen.findByText(/Coffee/)

    // Create mode: the sentinel sits after the spendable Wallet.
    const dialog = await openCreateForm()
    expect(walletOptions(dialog)).toEqual(['Cash (€100.00)', '＋ Add wallet…'])
    // Contact Wallets are not spendable: never in this select, sentinel or not.
    expect(screen.queryByText(/Marco/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Edit mode carries the same sentinel.
    fireEvent.click(screen.getByText('Coffee'))
    const editDialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    expect(walletOptions(editDialog)).toEqual(['Cash (€100.00)', '＋ Add wallet…'])
  })

  it('shows the sentinel as the only row when no spendable wallets exist', async () => {
    // Only ineligible wallets: a Frozen one and a Contact one. The sentinel
    // is the only row, so a wallet can still be created inline.
    fetchWalletsMock.mockResolvedValue([frozenWallet, marcoWallet])
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    expect(walletOptions(dialog)).toEqual(['＋ Add wallet…'])
  })

  it('picking the Expense/Income sentinel opens the New wallet modal without Contact and reverts the dropdown', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(walletSelect).toHaveValue('1')

    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // The Type options are restricted to non-Contact wallets: Contact
    // Wallets move money only via Transfers.
    const typeSelect = within(walletDialog).getByLabelText('Type')
    expect(
      Array.from(typeSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Checking', 'Credit Card', 'Cash'])
    // The dropdown reverted to its previous value; the outer draft is intact.
    expect(walletSelect).toHaveValue('1')
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(null)
  })

  it('a Transfer From/To sentinel opens the modal with all four types and reverts only the picked field', async () => {
    fetchWalletsMock.mockResolvedValue([wallet, marcoWallet])
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }))

    // Contact Wallets are offered for Transfers, plus the sentinel, in both
    // selects.
    expect(transferOptions(dialog, 'From')).toEqual([
      'Cash (€100.00)',
      'Marco (€0.00)',
      '＋ Add wallet…',
    ])
    expect(transferOptions(dialog, 'To')).toEqual([
      'Cash (€100.00)',
      'Marco (€0.00)',
      '＋ Add wallet…',
    ])

    const fromSelect = within(dialog).getByLabelText('From')
    const toSelect = within(dialog).getByLabelText('To')
    // Swap both so the revert is observable on the picked field.
    fireEvent.change(fromSelect, { target: { value: '4' } })
    fireEvent.change(toSelect, { target: { value: '1' } })

    fireEvent.change(fromSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // Transfers are where Contact Wallets belong: all four types offered.
    const typeSelect = within(walletDialog).getByLabelText('Type')
    expect(
      Array.from(typeSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Checking', 'Credit Card', 'Cash', 'Contact'])
    // Only the From select reverted; To is untouched.
    expect(fromSelect).toHaveValue('4')
    expect(toSelect).toHaveValue('1')

    // The same from the To side: only To reverts.
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    fireEvent.change(toSelect, { target: { value: SENTINEL_VALUE } })
    await screen.findByRole('dialog', { name: 'New wallet' })
    expect(fromSelect).toHaveValue('4')
    expect(toSelect).toHaveValue('1')
  })

  it('the full flow for an Expense — sentinel, create, auto-select, submit — carries the new wallet id as wallet_id', async () => {
    createWalletMock.mockResolvedValue({
      id: 7,
      name: 'Revolut',
      type: 'checking',
      balance: '0.00',
      frozen: false,
      created_at: '2026-01-01T00:00:00Z',
    })
    createTransactionMock.mockResolvedValue({ ...newCoffee, wallet_id: 7 })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '12.50' },
    })

    const walletSelect = within(dialog).getByLabelText('Wallet')
    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    // The wallet is created with the default non-Contact type.
    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '',
      }),
    )
    // Only the inner modal closes; the form and its draft survive.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(12.5)
    // The new wallet is selected and offered in the dropdown.
    await waitFor(() => expect(walletSelect).toHaveValue('7'))
    expect(walletOptions(dialog)).toEqual([
      'Cash (€100.00)',
      'Revolut (€0.00)',
      '＋ Add wallet…',
    ])
    expect(createTransactionMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new wallet's id as wallet_id.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    await waitFor(() =>
      expect(createTransactionMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ walletId: 7 }),
      ),
    )
  })

  it('the full flow for a Transfer — sentinel on From, create, auto-select — carries the new wallet id as source_wallet_id only', async () => {
    fetchWalletsMock.mockResolvedValue([wallet, marcoWallet])
    createWalletMock.mockResolvedValue({
      id: 7,
      name: 'Revolut',
      type: 'checking',
      balance: '0.00',
      frozen: false,
      created_at: '2026-01-01T00:00:00Z',
    })
    createTransactionMock.mockResolvedValue({
      ...newCoffee,
      type: 'transfer',
      source_wallet_id: 7,
      destination_wallet_id: 4,
    })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }))
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '30.00' },
    })

    // From defaults to Cash (1), To to the Contact wallet (4).
    const fromSelect = within(dialog).getByLabelText('From')
    const toSelect = within(dialog).getByLabelText('To')
    expect(fromSelect).toHaveValue('1')
    expect(toSelect).toHaveValue('4')

    fireEvent.change(fromSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() => expect(createWalletMock).toHaveBeenCalled())
    // The new wallet lands in the exact field whose sentinel was picked
    // (From); To keeps its draft value.
    await waitFor(() => expect(fromSelect).toHaveValue('7'))
    expect(toSelect).toHaveValue('4')
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(30)
    // The new wallet is offered in both Transfer selects.
    expect(transferOptions(dialog, 'From')).toEqual([
      'Cash (€100.00)',
      'Marco (€0.00)',
      'Revolut (€0.00)',
      '＋ Add wallet…',
    ])

    // Submitting carries the new wallet's id as the source leg.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    await waitFor(() =>
      expect(createTransactionMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({
          type: 'transfer',
          sourceWalletId: 7,
          destinationWalletId: 4,
        }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the wallet modal and leave the form draft intact', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '9.99' },
    })

    // Opens the stacked Wallet modal on top of the open form.
    const openWalletModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Wallet'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New wallet' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(9.99)
    }

    // Cancel closes only the inner modal.
    let walletDialog = await openWalletModal()
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // Backdrop tap closes only the inner modal.
    walletDialog = await openWalletModal()
    fireEvent.click(walletDialog.previousElementSibling as Element)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // One Escape closes only the topmost modal; a second closes the form.
    walletDialog = await openWalletModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    formSurvives()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createWalletMock).not.toHaveBeenCalled()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('a duplicate wallet name shows the validation error inside the modal and selects nothing', async () => {
    createWalletMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    const walletSelect = within(dialog).getByLabelText('Wallet')
    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Cash' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    expect(
      await within(walletDialog).findByText('A wallet with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open and nothing is selected; the outer draft is intact.
    expect(screen.getByRole('dialog', { name: 'New wallet' })).toBeInTheDocument()
    expect(walletSelect).toHaveValue('1')

    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('edit mode locks the Wallet select, so the sentinel is inert there', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    fireEvent.click(screen.getByText('Coffee'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit transaction' })

    // Wallets are locked while editing (issue #24): the sentinel is visible
    // but the select cannot be touched, so no wallet modal can open.
    expect(within(dialog).getByLabelText('Wallet')).toBeDisabled()
    expect(walletOptions(dialog)).toEqual(['Cash (€100.00)', '＋ Add wallet…'])
    expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument()
  })
})

describe('TransactionsScreen inline recurring cost creation (issue #73)', () => {
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New transaction' }))
    return await screen.findByRole('dialog', { name: 'New transaction' })
  }

  /** The Recurring Cost select's options, in order. */
  const recurringCostOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Recurring Cost').querySelectorAll('option'),
    ).map((option) => option.textContent)

  /** The Recurring Income select's options, in order. */
  const recurringIncomeOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Recurring Income').querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option, after None, in create and edit modes, for Expense and Income', async () => {
    fetchRecurringCostsMock.mockResolvedValue([rentCost])
    fetchRecurringIncomesMock.mockResolvedValue([salaryIncome])
    fetchTransactionsMock.mockImplementation(async () => ({
      items: [coffee, salary],
      next_cursor: null,
    }))
    render(<Harness />)
    await screen.findByText(/Coffee/)

    // Create mode, Expense (the default type): the sentinel sits last.
    const dialog = await openCreateForm()
    expect(recurringCostOptions(dialog)).toEqual([
      'None',
      'Rent',
      '＋ Add recurring cost…',
    ])

    // Switching to Income swaps the picker for the Recurring Income one;
    // its sentinel mirrors it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    expect(within(dialog).queryByLabelText('Recurring Cost')).not.toBeInTheDocument()
    expect(recurringIncomeOptions(dialog)).toEqual([
      'None',
      'Salary',
      '＋ Add recurring income…',
    ])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Edit mode carries the same sentinel, for both kinds of Transaction.
    fireEvent.click(screen.getByText('Coffee'))
    let editDialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    expect(recurringCostOptions(editDialog)).toEqual([
      'None',
      'Rent',
      '＋ Add recurring cost…',
    ])
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('Salary'))
    editDialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    expect(recurringIncomeOptions(editDialog)).toEqual([
      'None',
      'Salary',
      '＋ Add recurring income…',
    ])
  })

  it('picking the sentinel opens the New recurring cost modal and reverts the dropdown', async () => {
    fetchRecurringCostsMock.mockResolvedValue([rentCost])
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    const costSelect = within(dialog).getByLabelText('Recurring Cost')
    // A real selection first, so the revert is observable.
    fireEvent.change(costSelect, { target: { value: '11' } })
    expect(costSelect).toHaveValue('11')

    fireEvent.change(costSelect, { target: { value: SENTINEL_VALUE } })
    const costDialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    // The dropdown reverted to its previous value; the outer draft is intact.
    expect(costSelect).toHaveValue('11')
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(null)
    // The recurring form's own Name field is the first field — it has no
    // Wallet or Category of its own to carry sentinels for (the definition
    // never carries them).
    expect(within(costDialog).getByLabelText('Name')).toBeInTheDocument()
  })

  it('the full flow — sentinel, create, auto-select, submit — carries the new cost id and shows the paid occurrence', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    createTransactionMock.mockResolvedValue({ ...newCoffee, recurring_cost_id: 11 })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '850.00' },
    })

    const costSelect = within(dialog).getByLabelText('Recurring Cost')
    fireEvent.change(costSelect, { target: { value: SENTINEL_VALUE } })
    const costDialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(costDialog).getByLabelText('Name'), {
      target: { value: 'Rent' },
    })
    fireEvent.change(within(costDialog).getByLabelText('Amount'), {
      target: { value: '850.00' },
    })
    fireEvent.click(
      within(costDialog).getByRole('button', { name: 'Create recurring cost' }),
    )

    // The definition is created through the existing endpoint.
    await waitFor(() =>
      expect(createRecurringCostMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ name: 'Rent', amount: '850.00' }),
      ),
    )
    // Only the recurring modal closes; the form and its draft survive.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'New recurring cost' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(850)
    // The new definition is auto-selected, offered in the dropdown, and the
    // linking helper names the Occurrence it pays (due today for a fresh
    // definition with no start date).
    await waitFor(() => expect(costSelect).toHaveValue('11'))
    expect(recurringCostOptions(dialog)).toEqual([
      'None',
      'Rent',
      '＋ Add recurring cost…',
    ])
    expect(
      within(dialog).getByText('Pays the occurrence of 2026-08-01.'),
    ).toBeInTheDocument()
    expect(createTransactionMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new definition's id as the link.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    await waitFor(() =>
      expect(createTransactionMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ recurringCostId: 11 }),
      ),
    )
  })

  it('the full flow for an Income — sentinel, create, auto-select, submit — carries the new income id', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([])
    createTransactionMock.mockResolvedValue({
      ...newCoffee,
      type: 'income',
      recurring_income_id: 12,
    })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '2100.00' },
    })

    const incomeSelect = within(dialog).getByLabelText('Recurring Income')
    fireEvent.change(incomeSelect, { target: { value: SENTINEL_VALUE } })
    const incomeDialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(incomeDialog).getByLabelText('Name'), {
      target: { value: 'Salary' },
    })
    fireEvent.change(within(incomeDialog).getByLabelText('Amount'), {
      target: { value: '2100.00' },
    })
    fireEvent.click(
      within(incomeDialog).getByRole('button', { name: 'Create recurring income' }),
    )

    await waitFor(() =>
      expect(createRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ name: 'Salary', amount: '2100.00' }),
      ),
    )
    // Auto-selected in the Income form; the draft and the helper survive.
    await waitFor(() => expect(incomeSelect).toHaveValue('12'))
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(2100)
    expect(
      within(dialog).getByText('Pays the occurrence of 2026-08-01.'),
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    await waitFor(() =>
      expect(createTransactionMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ type: 'income', recurringIncomeId: 12 }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the recurring modal and leave the form draft intact', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), {
      target: { value: '9.99' },
    })

    // Opens the stacked Recurring Cost modal on top of the open form.
    const openCostModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Recurring Cost'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New recurring cost' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(9.99)
    }

    // Cancel closes only the inner modal.
    let costDialog = await openCostModal()
    fireEvent.click(within(costDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'New recurring cost' }),
      ).not.toBeInTheDocument(),
    )
    formSurvives()

    // Backdrop tap closes only the inner modal.
    costDialog = await openCostModal()
    fireEvent.click(costDialog.previousElementSibling as Element)
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'New recurring cost' }),
      ).not.toBeInTheDocument(),
    )
    formSurvives()

    // One Escape closes only the topmost modal; a second closes the form.
    costDialog = await openCostModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'New recurring cost' }),
      ).not.toBeInTheDocument(),
    )
    formSurvives()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringCostMock).not.toHaveBeenCalled()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('works in edit mode: the inline Recurring Cost is auto-selected and the edit carries its id', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    updateTransactionMock.mockResolvedValue({ ...baseTransaction, recurring_cost_id: 11 })
    render(<Harness />)
    await screen.findByText(/Coffee/)

    fireEvent.click(screen.getByText('Coffee'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit transaction' })
    const costSelect = within(dialog).getByLabelText('Recurring Cost')
    expect(costSelect).toHaveValue('')

    fireEvent.change(costSelect, { target: { value: SENTINEL_VALUE } })
    const costDialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(costDialog).getByLabelText('Name'), {
      target: { value: 'Rent' },
    })
    fireEvent.change(within(costDialog).getByLabelText('Amount'), {
      target: { value: '850.00' },
    })
    fireEvent.click(
      within(costDialog).getByRole('button', { name: 'Create recurring cost' }),
    )

    // Auto-selected in the open edit form; the helper names the paid
    // Occurrence (the new definition's oldest Unpaid one).
    await waitFor(() => expect(costSelect).toHaveValue('11'))
    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeInTheDocument()
    expect(
      within(dialog).getByText('Pays the occurrence of 2026-08-01.'),
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateTransactionMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ recurringCostId: 11 }),
      ),
    )
  })
})




describe('TransactionsScreen export (US 7.3)', () => {
  it('downloads the filtered ledger under the server filename', async () => {
    const createObjectURL = vi.fn(() => 'blob:export')
    const revokeObjectURL = vi.fn()
    // Restore URL by hand instead of unstubAllGlobals: the file-wide
    // IntersectionObserver stub (beforeAll) must survive this test.
    const realURL = URL
    vi.stubGlobal('URL', { ...realURL, createObjectURL, revokeObjectURL })
    // Mutated by the click spy (a closure assignment would not widen the
    // outer flow's narrowing), so the read below stays typed.
    const downloaded = { href: '', name: '' }
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded.href = this.href
        downloaded.name = this.download
      })

    // Frozen Wallets are fetched explicitly so the dropdown can offer them;
    // override before render, so the select has the option when the change
    // fires.
    fetchWalletsMock.mockResolvedValue([wallet, frozenWallet])
    render(<Harness />)
    await screen.findByText(/Coffee/)
    // The export honors the current filters: select a Frozen Wallet first.
    fireEvent.click(screen.getByRole('button', { name: /filters/i }))
    fireEvent.change(await screen.findByLabelText('Wallet'), {
      target: { value: '2' },
    })
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 2 }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() =>
      expect(exportTransactionsMock).toHaveBeenCalledWith('', { walletId: 2 }),
    )
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(downloaded.name).toBe('budjetame-2026-08-23.xlsx')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')

    click.mockRestore()
    vi.stubGlobal('URL', realURL)
  })

  it('shows an error banner when the export fails', async () => {
    exportTransactionsMock.mockRejectedValue(
      new ApiError('Could not export transactions', 500),
    )

    render(<Harness />)
    await screen.findByText(/Coffee/)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(
      await screen.findByText(/could not export transactions/i),
    ).toBeInTheDocument()
  })

  it('hides the export button while the import draft is open', async () => {
    render(<Harness />)
    await screen.findByText(/Coffee/)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })
})
