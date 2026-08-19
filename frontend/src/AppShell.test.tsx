/** App shell swipe navigation (#51): a horizontal single-touch gesture on the
 * main content area moves one tab in the gesture's direction, clamped at the
 * ends; vertical scrolls, gestures starting on a control or within ~20px of a
 * screen edge, and touches inside an open modal never switch; the bottom nav
 * and desktop mouse behavior are unchanged. The API client is mocked;
 * gestures are fired as real touch events, never via internal state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { AppShell } from './App'

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
    fetchExpenseTrend: vi.fn(),
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
  fetchCategories,
  fetchDashboardSummary,
  fetchExpenseTrend,
  fetchRecurringCosts,
  fetchRecurringIncomes,
  fetchTransactions,
  fetchWallets,
} from './api'

const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const fetchTransactionsMock = vi.mocked(fetchTransactions)
const fetchDashboardSummaryMock = vi.mocked(fetchDashboardSummary)
const fetchExpenseTrendMock = vi.mocked(fetchExpenseTrend)
const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)

type Tab = 'dashboard' | 'wallets' | 'transactions' | 'categories' | 'recurring'

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
  render(<AppShell email="demo@budjetame.example" onSignOut={vi.fn()} />)
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
  }))
  fetchExpenseTrendMock.mockImplementation(async (_token, fromMonth, toMonth) => ({
    from_month: fromMonth,
    to_month: toMonth,
    months: [],
  }))
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
    expect(screen.queryByText('Net Worth')).not.toBeInTheDocument()
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
    expect(screen.queryByText('Net Worth')).not.toBeInTheDocument()
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
