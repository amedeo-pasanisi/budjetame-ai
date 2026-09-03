/** App shell swipe navigation (#51): a horizontal single-touch gesture on the
 * main content area moves one tab in the gesture's direction, clamped at the
 * ends; vertical scrolls, gestures starting on a control or within ~20px of a
 * screen edge, and touches inside an open modal never switch; the bottom nav
 * and desktop mouse behavior are unchanged. The API client is mocked;
 * gestures are fired as real touch events, never via internal state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { AppShell } from './App'
import { bumpDataVersion } from './api/dataVersion'

vi.mock('./api', async () => {
  // The real display helpers stay live (formatting is part of the screens'
  // contract); only the resource calls are mocked.
  const { formatEuros, formatSignedEuros } = await import('./api/format')
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  class CategoryMergeConflict extends Error {
    targetId: number
    transactionCount: number

    constructor(payload: { message: string; target_id: number; transaction_count: number }) {
      super(payload.message)
      this.targetId = payload.target_id
      this.transactionCount = payload.transaction_count
    }
  }
  return {
    TOKEN_KEY: 'budjetame.token',
    PAGE_LIMIT: 50,
    ApiError,
    CategoryMergeConflict,
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError
        ? error.status === 409
          ? conflict
          : fallback
        : fallback,
    formatEuros,
    formatSignedEuros,
    login: vi.fn(),
    fetchCurrentAccount: vi.fn(),
    fetchWallets: vi.fn(),
    createWallet: vi.fn(),
    renameWallet: vi.fn(),
    freezeWallet: vi.fn(),
    unfreezeWallet: vi.fn(),
    fetchCategories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    mergeCategories: vi.fn(),
    fetchTransactions: vi.fn(),
    createTransaction: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
    fetchDashboardSummary: vi.fn(),
    fetchTrend: vi.fn(),
    fetchBudget: vi.fn(),
    previewImport: vi.fn(),
    confirmImport: vi.fn(),
    validateImportRow: vi.fn(),
    fetchRecurringCosts: vi.fn(),
    createRecurringCost: vi.fn(),
    updateRecurringCost: vi.fn(),
    deleteRecurringCost: vi.fn(),
    fetchRecurringIncomes: vi.fn(),
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    deleteRecurringIncome: vi.fn(),
  }
})

// The map picker is a separate seam (issue #27); this test is about the shell.
vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import {
  fetchBudget,
  fetchCategories,
  fetchDashboardSummary,
  fetchTrend,
  fetchRecurringCosts,
  fetchRecurringIncomes,
  fetchTransactions,
  fetchWallets,
} from './api'
import type { Category, Wallet } from './api'

const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const fetchTransactionsMock = vi.mocked(fetchTransactions)
const fetchDashboardSummaryMock = vi.mocked(fetchDashboardSummary)
const fetchTrendMock = vi.mocked(fetchTrend)
const fetchBudgetMock = vi.mocked(fetchBudget)
const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)

type Tab = 'dashboard' | 'wallets' | 'transactions' | 'categories' | 'recurring'

/** The keep-alive panel wrapping the tab that contains `text` (ADR-0022):
 * a visited tab's panel stays mounted and is hidden with the `hidden`
 * attribute while another tab is active. */
function panelOf(text: string): HTMLElement {
  const panel = screen.getByText(text).closest('[data-tab]')
  expect(panel).not.toBeNull()
  return panel as HTMLElement
}

/** The one piece of each screen that identifies the active tab. */
async function expectTab(tab: Tab) {
  if (tab === 'dashboard') await screen.findByText('Net Worth')
  if (tab === 'wallets') await screen.findByRole('button', { name: 'New wallet' })
  if (tab === 'transactions') {
    await screen.findByRole('button', { name: 'New transaction' })
  }
  if (tab === 'categories') await screen.findByRole('button', { name: 'New category' })
  if (tab === 'recurring') {
    await screen.findByRole('button', { name: 'New recurring cost' })
  }
}

async function renderShell() {
  render(<AppShell email="demo@budjetame.example" onSignOut={vi.fn()} onDeleteAccount={vi.fn()} />)
  await expectTab('dashboard')
}

/** One finger down at `from`, a single move to `to`, then lift. */
function swipe(
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  fireEvent.touchStart(target, {
    touches: [{ identifier: 1, target, clientX: from.x, clientY: from.y }],
  })
  fireEvent.touchMove(target, {
    touches: [{ identifier: 1, target, clientX: to.x, clientY: to.y }],
  })
  fireEvent.touchEnd(target, { touches: [] })
}

beforeEach(() => {
  fetchWalletsMock.mockResolvedValue([])
  fetchCategoriesMock.mockResolvedValue([])
  fetchRecurringCostsMock.mockResolvedValue([])
  fetchRecurringIncomesMock.mockResolvedValue([])
  fetchTransactionsMock.mockResolvedValue({ items: [], next_cursor: null })
  // Echo the requested month/range so the dashboard's loaded-state guards
  // pass; every number is zero so no charts render.
  fetchDashboardSummaryMock.mockImplementation(async (_token, month) => ({
    month: month ?? '',
    net_worth: '0.00',
    income: '0.00',
    expenses: '0.00',
    expenses_by_category: [],
    incomes_by_category: [],
  }))
  fetchTrendMock.mockImplementation(async (_token, _kind, fromMonth, toMonth) => ({
    from_month: fromMonth,
    to_month: toMonth,
    months: [],
  }))
  // The Budget card (issue #66): an all-zero month, hidden by the empty
  // Recurring lists — this suite is about the shell, not the card.
  fetchBudgetMock.mockResolvedValue({
    month: '',
    monthly_spendable: '0.00',
    daily_allowance: '0.00',
    spendable_today: '0.00',
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('AppShell swipe navigation', () => {
  it('a right-to-left swipe walks the tabs in nav order', async () => {
    await renderShell()
    const main = screen.getByRole('main')
    swipe(main, { x: 400, y: 200 }, { x: 280, y: 205 })
    await expectTab('wallets')
    swipe(main, { x: 400, y: 200 }, { x: 280, y: 205 })
    await expectTab('transactions')
    swipe(main, { x: 400, y: 200 }, { x: 280, y: 205 })
    await expectTab('categories')
    swipe(main, { x: 400, y: 200 }, { x: 280, y: 205 })
    await expectTab('recurring')
    // The Dashboard panel stays mounted (tab keep-alive, ADR-0022) —
    // hidden, not unmounted.
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(panelOf('Net Worth')).toHaveAttribute('hidden')
    expect(panelOf('New recurring cost')).not.toHaveAttribute('hidden')
  })

  it('a left-to-right swipe opens the previous tab', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    swipe(screen.getByRole('main'), { x: 300, y: 200 }, { x: 430, y: 205 })
    await expectTab('dashboard')
  })

  it('does not wrap around from the first tab', async () => {
    await renderShell()
    swipe(screen.getByRole('main'), { x: 300, y: 200 }, { x: 430, y: 205 })
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })

  it('does not wrap around from the last tab', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }))
    await expectTab('recurring')
    swipe(screen.getByRole('main'), { x: 400, y: 200 }, { x: 280, y: 205 })
    expect(screen.getByRole('button', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(panelOf('Net Worth')).toHaveAttribute('hidden')
  })

  it('a mostly-vertical gesture never changes the tab', async () => {
    await renderShell()
    const main = screen.getByRole('main')
    swipe(main, { x: 400, y: 100 }, { x: 410, y: 320 })
    // Equal horizontal and vertical travel: the scroll wins the tie.
    swipe(main, { x: 400, y: 100 }, { x: 500, y: 200 })
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })

  it('a gesture under the 60px threshold never changes the tab', async () => {
    await renderShell()
    swipe(screen.getByRole('main'), { x: 400, y: 200 }, { x: 350, y: 205 })
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })

  it('a swipe starting on a button never changes the tab', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
    const newTransaction = await screen.findByRole('button', { name: 'New transaction' })
    swipe(newTransaction, { x: 400, y: 200 }, { x: 280, y: 205 })
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument()
  })

  it('a swipe starting on a form control never changes the tab', async () => {
    await renderShell()
    // The dashboard's trend From input: a labeled form control in the
    // content area.
    const monthInput = screen.getByLabelText('From')
    swipe(monthInput, { x: 400, y: 200 }, { x: 280, y: 205 })
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })

  it('a swipe starting within 20px of a screen edge never changes the tab', async () => {
    await renderShell()
    const main = screen.getByRole('main')
    swipe(main, { x: 10, y: 200 }, { x: 300, y: 205 })
    swipe(main, { x: window.innerWidth - 10, y: 200 }, { x: window.innerWidth - 300, y: 205 })
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })

  it('a swipe while a modal is open never changes the tab', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
    const newTransaction = await screen.findByRole('button', { name: 'New transaction' })
    await waitFor(() => expect(newTransaction).toBeEnabled())
    fireEvent.click(newTransaction)
    const dialog = await screen.findByRole('dialog', { name: 'New transaction' })
    // A finger on the form, then one on the dark backdrop: both belong to
    // the open modal and must not move the tab.
    swipe(dialog, { x: 400, y: 200 }, { x: 280, y: 205 })
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument()
    const overlay = dialog.parentElement
    expect(overlay).not.toBeNull()
    swipe(overlay as Element, { x: 400, y: 200 }, { x: 280, y: 205 })
    expect(screen.getByRole('dialog', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument()
    // Closing the modal restores the swipe — the guard is not sticky.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    swipe(screen.getByRole('main'), { x: 400, y: 200 }, { x: 280, y: 205 })
    await expectTab('categories')
  })

  it('a second finger cancels the gesture', async () => {
    await renderShell()
    const main = screen.getByRole('main')
    fireEvent.touchStart(main, {
      touches: [{ identifier: 1, target: main, clientX: 400, clientY: 200 }],
    })
    fireEvent.touchMove(main, {
      touches: [{ identifier: 1, target: main, clientX: 300, clientY: 205 }],
    })
    fireEvent.touchStart(main, {
      touches: [
        { identifier: 1, target: main, clientX: 300, clientY: 205 },
        { identifier: 2, target: main, clientX: 450, clientY: 300 },
      ],
    })
    fireEvent.touchEnd(main, {
      touches: [{ identifier: 2, target: main, clientX: 450, clientY: 300 }],
    })
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })

  it('clicking the bottom nav still switches tabs', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))
    await expectTab('categories')
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    await expectTab('dashboard')
  })

  it('mouse drags do nothing', async () => {
    await renderShell()
    const main = screen.getByRole('main')
    fireEvent.mouseDown(main, { clientX: 400, clientY: 200 })
    fireEvent.mouseMove(main, { clientX: 280, clientY: 205 })
    fireEvent.mouseUp(main)
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
  })
})

describe('AppShell settings (issue #84)', () => {
  it('opens the settings modal from the gear and closes it again', async () => {
    await renderShell()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument()
  })
})

describe('AppShell tab keep-alive (ADR-0022)', () => {
  it('keeps a visited tab mounted and does not refetch on a revisit', async () => {
    await renderShell()
    // Lazy mount: a tab is not mounted until its first visit.
    expect(screen.queryByRole('button', { name: 'New wallet' })).not.toBeInTheDocument()
    expect(fetchWalletsMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    expect(fetchWalletsMock).toHaveBeenCalledTimes(1)
    expect(panelOf('New wallet')).not.toHaveAttribute('hidden')
    expect(panelOf('Net Worth')).toHaveAttribute('hidden')

    // Away and back: the panel is still mounted, no new fetch — the tab
    // switch renders instantly from the loaded data.
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    await expectTab('dashboard')
    expect(panelOf('New wallet')).toHaveAttribute('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    expect(fetchWalletsMock).toHaveBeenCalledTimes(1)
  })

  it('refetches a mounted tab in the background when a write bumps the data version', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    const callsBefore = fetchWalletsMock.mock.calls.length

    // A write elsewhere — the transport bumps the cache clock on every
    // successful write (ADR-0022) — refetches the mounted Wallets tab in
    // the background, hidden or not.
    act(() => bumpDataVersion())

    await waitFor(() =>
      expect(fetchWalletsMock.mock.calls.length).toBe(callsBefore + 1),
    )
  })
})

describe('AppShell wallet ledger jump (issue #93)', () => {
  // Two active Contact wallets and one frozen credit card: enough rows to
  // jump twice in a row and to land on a frozen wallet's read-only history.
  const createdAt = '2026-08-01T10:00:00Z'
  const walletFixtures: Wallet[] = [
    { id: 1, name: 'Marco', type: 'contact', balance: '10.00', frozen: false, created_at: createdAt },
    { id: 2, name: 'anna', type: 'contact', balance: '-30.00', frozen: false, created_at: createdAt },
    { id: 3, name: 'Old Card', type: 'credit_card', balance: '0.00', frozen: true, created_at: createdAt },
  ]

  beforeEach(() => {
    fetchWalletsMock.mockResolvedValue(walletFixtures)
  })

  it('an active Wallet row tap opens the Transactions tab filtered to that Wallet', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: /^Marco/ }))

    await expectTab('transactions')
    // The very first ledger fetch carries the jump's filter: no unfiltered
    // fetch first, and the chip line names the Wallet.
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 1 }),
    )
    expect(
      screen.getByRole('button', { name: 'Remove Marco filter' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No transactions match these filters.'),
    ).toBeInTheDocument()
    expect(panelOf('New wallet')).toHaveAttribute('hidden')
    expect(panelOf('New transaction')).not.toHaveAttribute('hidden')
  })

  it('a frozen Wallet row tap does the same and the read-only banner shows on arrival', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Old Card/ }))

    await expectTab('transactions')
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 3 }),
    )
    expect(
      screen.getByRole('button', { name: 'Remove Old Card filter' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(
        'This wallet is frozen — its history is viewable but read-only.',
      ),
    ).toBeInTheDocument()
  })

  it('a later Wallet row jump replaces the filter on the already-mounted Transactions tab', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(screen.getByRole('button', { name: /^Marco/ }))
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 1 }),
    )
    await screen.findByText('No transactions match these filters.')

    // Back to Wallets (its panel stayed mounted) and jump to a different
    // Wallet: the mounted ledger replaces its filter, never a remount.
    fetchTransactionsMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }))
    await expectTab('wallets')
    fireEvent.click(screen.getByRole('button', { name: /^anna/ }))

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { walletId: 2 }),
    )
    expect(
      screen.getByRole('button', { name: 'Remove anna filter' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove Marco filter' }),
    ).not.toBeInTheDocument()
    expect(panelOf('New wallet')).toHaveAttribute('hidden')
    expect(panelOf('New transaction')).not.toHaveAttribute('hidden')
  })
})

describe('AppShell category ledger jump (issue #94)', () => {
  // One expense and one income Category: the ledger's Category filter
  // covers both directions, so a row tap must jump either way.
  const createdAt = '2026-08-01T10:00:00Z'
  const categoryFixtures: Category[] = [
    { id: 1, name: 'Food', type: 'expense', icon: '🍎', color: '#ef4444', created_at: createdAt },
    { id: 2, name: 'Salary', type: 'income', icon: '💼', color: '#3b82f6', created_at: createdAt },
  ]

  beforeEach(() => {
    fetchCategoriesMock.mockResolvedValue(categoryFixtures)
  })

  it('an expense Category row tap opens the Transactions tab filtered to that Category', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))
    await expectTab('categories')
    await screen.findByRole('region', { name: 'Expenses' })

    fireEvent.click(screen.getByRole('button', { name: /^Food/ }))

    await expectTab('transactions')
    // The very first ledger fetch carries the jump's filter: no unfiltered
    // fetch first, and the chip line names the Category.
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { categoryId: 1 }),
    )
    expect(
      screen.getByRole('button', { name: 'Remove Food filter' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No transactions match these filters.'),
    ).toBeInTheDocument()
    expect(panelOf('New category')).toHaveAttribute('hidden')
    expect(panelOf('New transaction')).not.toHaveAttribute('hidden')
  })

  it('an income Category row tap does the same — the ledger filter covers both directions', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))
    await expectTab('categories')
    await screen.findByRole('region', { name: 'Expenses' })

    fireEvent.click(screen.getByRole('button', { name: /^Salary/ }))

    await expectTab('transactions')
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { categoryId: 2 }),
    )
    expect(
      screen.getByRole('button', { name: 'Remove Salary filter' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('No transactions match these filters.'),
    ).toBeInTheDocument()
  })

  it('a later Category row jump replaces the filter on the already-mounted Transactions tab', async () => {
    await renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))
    await expectTab('categories')
    await screen.findByRole('region', { name: 'Expenses' })
    fireEvent.click(screen.getByRole('button', { name: /^Food/ }))
    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { categoryId: 1 }),
    )
    await screen.findByText('No transactions match these filters.')

    // Back to Categories (its panel stayed mounted) and jump to a
    // different Category: the mounted ledger replaces its filter, never a
    // remount.
    fetchTransactionsMock.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))
    await expectTab('categories')
    fireEvent.click(screen.getByRole('button', { name: /^Salary/ }))

    await waitFor(() =>
      expect(fetchTransactionsMock).toHaveBeenCalledWith('', { categoryId: 2 }),
    )
    expect(
      screen.getByRole('button', { name: 'Remove Salary filter' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove Food filter' }),
    ).not.toBeInTheDocument()
    expect(panelOf('New category')).toHaveAttribute('hidden')
    expect(panelOf('New transaction')).not.toHaveAttribute('hidden')
  })
})