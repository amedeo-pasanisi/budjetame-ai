/** The pinned Drafts block (ADR-0036, issues #122/#123): the Account's
 * Draft Transactions sit above the ledger on the Transactions tab, one row
 * per Draft with the same columns as a Transaction row and every missing
 * field marked; the block hides when there are no Drafts; Discard removes
 * the row at once through the api (whose transport bumps the cache clock).
 * Rendered in English and Italian. The api barrel is mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import { TransactionsScreen } from './TransactionsScreen'
import { renderWithIntl } from './test/renderWithIntl'
import { useImportDraft } from './importDraft'
import type {
  Category,
  DraftTransaction,
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
        ? error.status === 409 ? conflict : fallback
        : fallback,
    formatEuros: (value: string) => `€${value}`,
    formatLedgerDate: (value: string) => value,
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
    fetchRecurringCosts: vi.fn(),
    fetchRecurringIncomes: vi.fn(),
    fetchTransactions: vi.fn(),
    fetchDraftTransactions: vi.fn(),
    discardDraftTransaction: vi.fn(),
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

vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import {
  discardDraftTransaction,
  fetchCategories,
  fetchDraftTransactions,
  fetchRecurringCosts,
  fetchRecurringIncomes,
  fetchTransactions,
  fetchWallets,
} from './api'

const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const fetchTransactionsMock = vi.mocked(fetchTransactions)
const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)
const fetchDraftsMock = vi.mocked(fetchDraftTransactions)
const discardMock = vi.mocked(discardDraftTransaction)

const createdAt = '2026-08-01T10:00:00Z'

const wallets: Wallet[] = [
  { id: 1, name: 'Intesa', type: 'checking', balance: '1200.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Marco', type: 'contact', balance: '0.00', frozen: false, created_at: createdAt },
]

const categories: Category[] = [
  { id: 1, name: 'Food', icon: '🍕', type: 'expense', color: '#ef4444', created_at: createdAt },
]

const transactions: Transaction[] = [
  {
    id: 1,
    type: 'expense',
    amount: '10.00',
    date: '2026-08-23',
    wallet_id: 1,
    source_wallet_id: null,
    destination_wallet_id: null,
    category_id: 1,
    recurring_cost_id: null,
    recurring_income_id: null,
    description: 'Ledger lunch',
    latitude: null,
    longitude: null,
    place_name: null,
    place_id: null,
    occurrence_date: null,
    warning: false,
    created_at: createdAt,
  },
]

const page: TransactionPage = { items: transactions, next_cursor: null }

/** A complete Draft: every column resolved, nothing to mark. */
const complete: DraftTransaction = {
  id: 10,
  type: 'expense',
  amount: '30.00',
  date: '2026-11-18',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: 1,
  recurring_cost_id: null,
  recurring_income_id: null,
  description: 'Esselunga',
  created_at: createdAt,
}

/** A Draft the Assistant only half understood: no type, amount, date or
 * Wallet — only a description. */
const bare: DraftTransaction = {
  id: 11,
  type: null,
  amount: null,
  date: null,
  wallet_id: null,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  recurring_cost_id: null,
  recurring_income_id: null,
  description: 'something at the bar',
  created_at: createdAt,
}

/** A Transfer Draft missing its destination. */
const transfer: DraftTransaction = {
  id: 12,
  type: 'transfer',
  amount: '50.00',
  date: '2026-11-17',
  wallet_id: null,
  source_wallet_id: 1,
  destination_wallet_id: null,
  category_id: null,
  recurring_cost_id: null,
  recurring_income_id: null,
  description: null,
  created_at: createdAt,
}

function Harness() {
  const importState = useImportDraft()
  return (
    <TransactionsScreen
      importState={importState}
      pendingLedgerRequest={null}
      onConsumeLedgerRequest={() => {}}
    />
  )
}

function renderScreen(locale = 'en') {
  return renderWithIntl(<Harness />, { locale })
}

beforeEach(() => {
  fetchWalletsMock.mockResolvedValue(wallets)
  fetchCategoriesMock.mockResolvedValue(categories)
  fetchTransactionsMock.mockResolvedValue(page)
  fetchRecurringCostsMock.mockResolvedValue([])
  fetchRecurringIncomesMock.mockResolvedValue([])
  fetchDraftsMock.mockResolvedValue([])
  discardMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Drafts block (ADR-0036)', () => {
  it('hides the block when the Account has no Drafts', async () => {
    renderScreen()

    expect(await screen.findByText('Food · Ledger lunch')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('pins the Drafts above the ledger with the same columns as a row', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    const row = within(block).getByRole('listitem')
    expect(within(row).getByText('Food · Esselunga')).toBeInTheDocument()
    expect(row).toHaveTextContent('2026-11-18 · Intesa')
    expect(within(row).getByText('-€30.00')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    // Above the ledger: the block precedes the ledger list in the document.
    const ledgerRow = screen.getByText('Food · Ledger lunch')
    expect(block.compareDocumentPosition(ledgerRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Nothing is marked missing on a complete Draft.
    expect(within(block).queryByText(/missing/i)).not.toBeInTheDocument()
  })

  it('marks every missing field', async () => {
    fetchDraftsMock.mockResolvedValue([bare, transfer])
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    const rows = within(block).getAllByRole('listitem')
    expect(rows).toHaveLength(2)

    const bareRow = within(rows[0])
    expect(bareRow.getByText('something at the bar')).toBeInTheDocument()
    expect(bareRow.getByText('Type missing')).toBeInTheDocument()
    expect(bareRow.getByText('Amount missing')).toBeInTheDocument()
    expect(bareRow.getByText('Date missing')).toBeInTheDocument()
    expect(bareRow.getByText('Wallet missing')).toBeInTheDocument()

    const transferRow = within(rows[1])
    expect(transferRow.getByText('Transfer')).toBeInTheDocument()
    expect(transferRow.getByText('€50.00')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('2026-11-17 · Intesa → Destination missing')
    expect(transferRow.getByText('Destination missing')).toBeInTheDocument()
    expect(transferRow.queryByText('Amount missing')).not.toBeInTheDocument()
    expect(transferRow.queryByText('Date missing')).not.toBeInTheDocument()
  })

  it('discards a Draft: the row goes at once and the api is called', async () => {
    fetchDraftsMock.mockResolvedValue([complete, bare])
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    const rows = within(block).getAllByRole('listitem')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Discard' }))

    expect(screen.queryByText('Food · Esselunga')).not.toBeInTheDocument()
    expect(screen.getByText('something at the bar')).toBeInTheDocument()
    await waitFor(() => expect(discardMock).toHaveBeenCalledWith('', 10))
  })

  it('discarding the last Draft hides the block', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fireEvent.click(within(block).getByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Drafts' })).not.toBeInTheDocument(),
    )
    // The ledger is untouched.
    expect(screen.getByText('Food · Ledger lunch')).toBeInTheDocument()
  })

  it('puts the row back with a message when the discard fails', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    discardMock.mockRejectedValue(new Error('boom'))
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fireEvent.click(within(block).getByRole('button', { name: 'Discard' }))

    expect(await screen.findByText('Could not discard the draft.')).toBeInTheDocument()
    expect(screen.getByText('Food · Esselunga')).toBeInTheDocument()
  })

  it('renders the block in Italian under locale it', async () => {
    fetchDraftsMock.mockResolvedValue([bare, transfer])
    renderScreen('it')

    const block = await screen.findByRole('region', { name: 'Bozze' })
    const rows = within(block).getAllByRole('listitem')
    const bareRow = within(rows[0])
    expect(bareRow.getByText('Tipo mancante')).toBeInTheDocument()
    expect(bareRow.getByText('Importo mancante')).toBeInTheDocument()
    expect(bareRow.getByText('Data mancante')).toBeInTheDocument()
    expect(bareRow.getByText('Portafoglio mancante')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Trasferimento')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Destinazione mancante')).toBeInTheDocument()
    expect(within(block).getAllByRole('button', { name: 'Scarta' })).toHaveLength(2)
  })
})
