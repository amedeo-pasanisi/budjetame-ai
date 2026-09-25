/** i18n Transactions screen tests (issue #117): the screen title, toolbar,
 * filters bar labels, and empty states render in Italian under Locale `it`,
 * English under `en`, with English as the fallback for any untranslated key. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { TransactionsScreen } from './TransactionsScreen'
import { renderWithIntl } from './test/renderWithIntl'
import { useImportDraft } from './importDraft'
import type { Category, Transaction, TransactionPage, Wallet } from './api'

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
  fetchCategories,
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

const createdAt = '2026-08-01T10:00:00Z'

const wallets: Wallet[] = [
  { id: 1, name: 'Intesa', type: 'checking', balance: '1200.00', frozen: false, created_at: createdAt },
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
    description: null,
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

function renderScreen(locale: string) {
  return renderWithIntl(<Harness />, { locale })
}

beforeEach(() => {
  fetchWalletsMock.mockResolvedValue(wallets)
  fetchCategoriesMock.mockResolvedValue(categories)
  fetchTransactionsMock.mockResolvedValue(page)
  fetchRecurringCostsMock.mockResolvedValue([])
  fetchRecurringIncomesMock.mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TransactionsScreen i18n (issue #117)', () => {
  it('renders English strings under locale en', async () => {
    renderScreen('en')

    expect(screen.getByText('Transactions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search transactions…')).toBeInTheDocument()

    // Open the filters bar
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    expect(screen.getByText('Wallet')).toBeInTheDocument()
    expect(screen.getByText('All wallets')).toBeInTheDocument()
    expect(screen.getByText('Recurring')).toBeInTheDocument()
    expect(screen.getByText('Category')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeInTheDocument()
  })

  it('renders Italian strings under locale it', async () => {
    renderScreen('it')

    expect(screen.getByText('Transazioni')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nuova transazione' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Cerca transazioni…')).toBeInTheDocument()

    // Open the filters bar
    fireEvent.click(screen.getByRole('button', { name: /Filtri/ }))
    expect(screen.getByText('Portafoglio')).toBeInTheDocument()
    expect(screen.getByText('Tutti i portafogli')).toBeInTheDocument()
    expect(screen.getByText('Ricorrente')).toBeInTheDocument()
    expect(screen.getByText('Categoria')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Esporta in Excel' })).toBeInTheDocument()
  })

  it('renders the Italian empty-ledger message under locale it', async () => {
    fetchTransactionsMock.mockResolvedValue({ items: [], next_cursor: null })
    renderScreen('it')

    expect(await screen.findByText('Ancora nessuna transazione.')).toBeInTheDocument()
  })

  it('renders the Italian frozen-wallet banner under locale it', async () => {
    const frozen: Wallet[] = [
      { id: 1, name: 'Intesa', type: 'checking', balance: '1200.00', frozen: true, created_at: createdAt },
    ]
    fetchWalletsMock.mockResolvedValue(frozen)
    renderScreen('it')

    // The banner shows when the frozen wallet is the active ledger filter:
    // open the filters bar, wait for the wallet select to load, pick it.
    fireEvent.click(screen.getByRole('button', { name: /Filtri/ }))
    const select = (await screen.findByLabelText('Portafoglio')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '1' } })

    expect(
      await screen.findByText(
        'Questo portafoglio è congelato — la sua cronologia è visibile ma in sola lettura.',
      ),
    ).toBeInTheDocument()
  })

  it('falls back to English for untranslated keys', async () => {
    renderScreen('de')

    expect(screen.getByText('Transactions')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search transactions…')).toBeInTheDocument()
  })
})
