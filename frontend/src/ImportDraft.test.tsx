/** Import Draft lifecycle (issue #43): the unconfirmed import state — picked
 * file, parsed rows, and row selections — lives in the app shell, so
 * switching to any other tab and back preserves it and returning to the
 * Transactions tab resumes the Preview exactly where it was left. The only
 * discard paths are Cancel, "Pick another file", and a successful import
 * (then Back); a page reload loses the draft because nothing is persisted.
 * The shell is rendered and driven like a user would (click tabs, pick a
 * file, read, toggle rows, confirm); the API client is mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { AppShell } from './App'
import type { ImportPreview, Transaction, Wallet } from './api'

vi.mock('./api', () => ({
  TOKEN_KEY: 'budjetame.token',
  PAGE_LIMIT: 50,
  formatEuros: (value: string) => `€${value}`,
  ApiError: class ApiError extends Error {},
  apiErrorMessage: (cause: unknown) =>
    cause instanceof Error ? cause.message : 'Something went wrong.',
  fetchWallets: vi.fn(),
  fetchCategories: vi.fn(),
  fetchRecurringCosts: vi.fn().mockResolvedValue([]),
  fetchRecurringIncomes: vi.fn().mockResolvedValue([]),
  fetchTransactions: vi.fn(),
  fetchDashboardSummary: vi.fn(),
  fetchTrend: vi.fn(),
  fetchBudget: vi.fn().mockResolvedValue({
    month: '',
    monthly_spendable: '0.00',
    daily_allowance: '0.00',
    spendable_today: '0.00',
  }),
  previewImport: vi.fn(),
  confirmImport: vi.fn(),
  validateImportRow: vi.fn(),
  // The screens not exercised here (forms, wallets, login) import these at
  // module scope; the mock must still provide them.
  fetchCurrentAccount: vi.fn(),
  login: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createWallet: vi.fn(),
  renameWallet: vi.fn(),
  freezeWallet: vi.fn(),
}))

// The map picker is a separate seam (issue #27); this test is about tabs.
vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import {
  confirmImport,
  fetchCategories,
  fetchDashboardSummary,
  fetchTrend,
  fetchTransactions,
  fetchWallets,
  previewImport,
  validateImportRow,
} from './api'

const previewImportMock = vi.mocked(previewImport)
const confirmImportMock = vi.mocked(confirmImport)
const validateImportRowMock = vi.mocked(validateImportRow)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const fetchTransactionsMock = vi.mocked(fetchTransactions)
const fetchDashboardSummaryMock = vi.mocked(fetchDashboardSummary)
const fetchTrendMock = vi.mocked(fetchTrend)

const wallet: Wallet = {
  id: 1,
  name: 'Cash',
  type: 'cash',
  balance: '100.00',
  frozen: false,
  created_at: '2026-01-01T00:00:00Z',
}

const transaction: Transaction = {
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
  description: 'Coffee',
  latitude: null,
  longitude: null,
  place_name: null,
  place_id: null,
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

/** Two ready rows (auto-selected), one duplicate, one problem. */
const preview: ImportPreview = {
  rows: [
    {
      row: 1,
      status: 'ok',
      type: 'expense',
      date: '2026-08-01',
      amount: '4.50',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: 'Coffee',
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 2,
      status: 'ok',
      type: 'income',
      date: '2026-08-02',
      amount: '100.00',
      wallet: 'Bank',
      source_wallet: null,
      destination_wallet: null,
      category: 'Salary',
      description: null,
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 3,
      status: 'duplicate',
      type: 'expense',
      date: '2026-08-01',
      amount: '4.50',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: 'Coffee',
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 4,
      status: 'error',
      type: 'expense',
      date: '2026-08-03',
      amount: '12.00',
      wallet: 'Unknown',
      source_wallet: null,
      destination_wallet: null,
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'Unknown'",
    },
  ],
  ok_count: 2,
  error_count: 1,
  duplicate_count: 1,
}

const importedTransaction: Transaction = {
  id: 9,
  type: 'income',
  amount: '100.00',
  date: '2026-08-02',
  wallet_id: 2,
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
  created_at: '2026-08-02T10:00:00Z',
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('budjetame.token', 'budjetame.token')
  fetchWalletsMock.mockResolvedValue([wallet])
  fetchCategoriesMock.mockResolvedValue([])
  fetchTransactionsMock.mockResolvedValue({ items: [transaction], next_cursor: null })
  fetchDashboardSummaryMock.mockResolvedValue({
    net_worth: '100.00',
    month: '2026-08',
    income: '0.00',
    expenses: '4.50',
    expenses_by_category: [],
    incomes_by_category: [],
  })
  fetchTrendMock.mockResolvedValue({
    from_month: '2026-03',
    to_month: '2026-08',
    months: [],
  })
  previewImportMock.mockResolvedValue(preview)
  confirmImportMock.mockResolvedValue([importedTransaction])
})

afterEach(() => {
  vi.clearAllMocks()
})

function renderShell() {
  return render(<AppShell email="user@example.com" onSignOut={vi.fn()} />)
}

/** From the Transactions tab: taps Import, picks a file, reads it, and lands
 * on the Preview with both ready rows selected. */
async function openPreview(view: ReturnType<typeof render>) {
  fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Import' }))
  const file = new File(['rows'], 'rows.csv', { type: 'text/csv' })
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
  fireEvent.change(input!, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Read and validate' }))
  await screen.findByRole('button', { name: 'Import 2 rows' })
}

describe('Import Draft lifecycle (issue #43)', () => {
  it('keeps the picked file, the parsed rows, and the selections across a tab switch and resumes the preview exactly as left', async () => {
    const view = renderShell()
    await openPreview(view)

    // Leave the selection asymmetric: keep only the second ready row.
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeInTheDocument()

    // Switch to another tab and back.
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))

    // The preview resumes where it was left: same rows, same selection,
    // without re-reading the file.
    expect(await screen.findByRole('button', { name: 'Import 1 row' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(previewImportMock).toHaveBeenCalledTimes(1)

    // Nothing was persisted: a page reload would lose the draft.
    expect(Object.keys(localStorage)).toEqual(['budjetame.token'])
  })

  it('keeps the picked file across a tab switch in the pick phase too', async () => {
    const view = renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))

    const file = new File(['rows'], 'rows.csv', { type: 'text/csv' })
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(input!, { target: { files: [file] } })
    expect(screen.getByText(/rows\.csv/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read and validate' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))

    // The picked file survived: it is still named and ready to read.
    expect(await screen.findByText(/rows\.csv/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read and validate' })).toBeEnabled()
    expect(previewImportMock).not.toHaveBeenCalled()
  })

  it('discards the draft on Cancel and starts the next import fresh', async () => {
    const view = renderShell()
    await openPreview(view)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Back on the normal transactions list; no preview artifacts remain.
    expect(
      await screen.findByRole('heading', { name: 'All transactions' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Import \d+ rows/ })).not.toBeInTheDocument()

    // The next import starts from the pick phase, not the old preview.
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('button', { name: 'Read and validate' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Import \d+ rows/ })).not.toBeInTheDocument()
  })

  it('discards the draft on "Pick another file" and re-reads a fresh preview', async () => {
    const view = renderShell()
    await openPreview(view)

    fireEvent.click(screen.getByRole('button', { name: 'Pick another file' }))

    // Back at the pick phase with no file: the old rows and selections are gone.
    expect(screen.getByRole('button', { name: 'Read and validate' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Import \d+ rows/ })).not.toBeInTheDocument()

    // Reading a new file starts over from scratch.
    const file = new File(['other'], 'other.csv', { type: 'text/csv' })
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    fireEvent.change(input!, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Read and validate' }))
    expect(
      await screen.findByRole('button', { name: 'Import 2 rows' }),
    ).toBeInTheDocument()
    expect(previewImportMock).toHaveBeenCalledTimes(2)
  })

  it('discards the draft after a successful import when Back is tapped', async () => {
    const view = renderShell()
    await openPreview(view)
    await waitFor(() => expect(fetchTransactionsMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }))
    expect(await screen.findByText(/Imported 1 transaction/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    // Back on the list, reloaded with the imported data; the draft is gone.
    expect(
      await screen.findByRole('heading', { name: 'All transactions' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(fetchTransactionsMock).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('button', { name: 'Read and validate' })).toBeDisabled()
  })

  it('behaves normally when no draft is pending: the list renders and Import starts at the pick phase', async () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))

    expect(
      await screen.findByRole('heading', { name: 'All transactions' }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/Coffee/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('button', { name: 'Read and validate' })).toBeDisabled()
  })

  it('keeps verification edits across a tab switch (issue #46)', async () => {
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    const view = renderShell()
    await openPreview(view)

    // Verify the problem row: the unknown wallet becomes a known one.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    fireEvent.change(within(dialog).getByLabelText('Wallet'), { target: { value: 'Cash' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Import 3 rows' })).toBeInTheDocument()

    // Switch to another tab and back: the verified row stays verified and
    // selected, without re-validating.
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }))

    expect(await screen.findByRole('button', { name: 'Import 3 rows' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit row 4' })).toHaveTextContent('Ready')
    expect(validateImportRowMock).toHaveBeenCalledTimes(1)
  })
})
