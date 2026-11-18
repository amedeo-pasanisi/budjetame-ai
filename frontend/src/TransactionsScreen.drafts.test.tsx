/** The pinned Drafts block (ADR-0036, issues #122/#123/#125): the Account's
 * Draft Transactions sit above the ledger on the Transactions tab, one row
 * per Draft with the same columns as a Transaction row and every missing
 * field marked; the block hides when there are no Drafts; Discard removes
 * the row at once through the api (whose transport bumps the cache clock).
 * Approve is one tap through the atomic endpoint; a 422 opens the
 * Transaction form pre-filled from the Draft, whose Save goes back through
 * Approve with the edited payload; Edit opens that form directly.
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
    approveDraftTransaction: vi.fn(),
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
  ApiError,
  approveDraftTransaction,
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
const approveMock = vi.mocked(approveDraftTransaction)

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

  /** The Transaction the one-tap Approve of `complete` creates, as the
   * endpoint answers it. */
  const approved: Transaction = {
    ...transactions[0],
    id: 2,
    amount: '30.00',
    date: '2026-11-18',
    description: 'Esselunga',
  }

  it('approves a complete Draft in one tap: the row goes and the ledger shows the Transaction', async () => {
    fetchDraftsMock.mockResolvedValue([complete, bare])
    approveMock.mockResolvedValue(approved)
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    const rows = within(block).getAllByRole('listitem')
    // The ledger's reload after the approval returns the new row.
    fetchTransactionsMock.mockResolvedValue({ items: [approved, ...transactions], next_cursor: null })
    fetchDraftsMock.mockResolvedValue([bare])
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('', 10))
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Drafts' })).queryByText('Food · Esselunga')).not.toBeInTheDocument(),
    )
    // No form opened: a complete Draft is one tap.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('something at the bar')).toBeInTheDocument()
    // The ledger reloaded and shows the new Transaction.
    expect(await screen.findByText('Food · Esselunga')).toBeInTheDocument()
    expect(screen.queryByText('Saved — this made a Cash wallet negative.')).not.toBeInTheDocument()
  })

  it('shows the write warning when the approved Transaction made a Cash wallet negative', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    approveMock.mockResolvedValue({ ...approved, warning: true })
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fetchDraftsMock.mockResolvedValue([])
    fireEvent.click(within(block).getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Saved — this made a Cash wallet negative.')).toBeInTheDocument()
  })

  it('reports a failed Approve and keeps the row', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    approveMock.mockRejectedValue(new Error('boom'))
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fireEvent.click(within(block).getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Could not approve the draft.')).toBeInTheDocument()
    expect(within(block).getByText('Food · Esselunga')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /** The payload the pre-filled form sends back through Approve for
   * `bare` once the user typed the amount and the date: the Wallet is the
   * create default (the first active one), the rest is the Draft's. */
  const bareEdited = {
    type: 'expense',
    amount: '7.50',
    date: '2026-11-18',
    walletId: 1,
    categoryId: null,
    recurringCostId: null,
    recurringIncomeId: null,
    description: 'something at the bar',
    latitude: null,
    longitude: null,
    place_name: null,
    place_id: null,
  }

  it('opens the form pre-filled on a 422 and its Save goes back through Approve with the edited payload', async () => {
    fetchDraftsMock.mockResolvedValue([bare])
    approveMock.mockRejectedValueOnce(
      new ApiError('A type is required: expense, income, or transfer', 422),
    )
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fireEvent.click(within(block).getByRole('button', { name: 'Approve' }))

    // The rule message opens the form, in its banner; what the Draft
    // carried is pre-filled, what it missed is empty.
    const dialog = await screen.findByRole('dialog', { name: 'New transaction' })
    expect(approveMock).toHaveBeenCalledWith('', 11)
    expect(
      within(dialog).getByText('A type is required: expense, income, or transfer'),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Description')).toHaveValue('something at the bar')
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue('')
    expect(within(dialog).getByLabelText('Date')).toHaveValue('')
    // The row is still there behind the form: nothing was approved.
    expect(screen.getByText('Amount missing')).toBeInTheDocument()

    // Save as is: the Field Errors point at what is left, nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))
    expect(within(dialog).getByText('Enter an amount')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose a date')).toBeInTheDocument()
    expect(approveMock).toHaveBeenCalledTimes(1)

    // Fill what is left: the Save goes through Approve with the override.
    approveMock.mockResolvedValueOnce({ ...approved, id: 3, amount: '7.50', category_id: null })
    fetchDraftsMock.mockResolvedValue([])
    fireEvent.change(within(dialog).getByLabelText('Amount (€)'), { target: { value: '7,5' } })
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-11-18' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))

    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('', 11, bareEdited))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('Edit opens the same pre-filled form directly, with no round trip and no banner', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fireEvent.click(within(block).getByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog', { name: 'New transaction' })
    expect(approveMock).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue('30.00')
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-11-18')
    expect(within(dialog).getByLabelText('Wallet')).toHaveValue('1')
    expect(within(dialog).getByLabelText('Category')).toHaveValue('1')
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Esselunga')
    expect(within(dialog).queryByText(/required|frozen/)).not.toBeInTheDocument()

    approveMock.mockResolvedValueOnce(approved)
    fetchDraftsMock.mockResolvedValue([])
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Esselunga, edited' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save transaction' }))

    await waitFor(() =>
      expect(approveMock).toHaveBeenCalledWith(
        '',
        10,
        expect.objectContaining({ type: 'expense', amount: '30.00', walletId: 1, categoryId: 1, description: 'Esselunga, edited' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Drafts' })).not.toBeInTheDocument()
  })

  it('Cancel on the pre-filled form keeps the Draft', async () => {
    fetchDraftsMock.mockResolvedValue([complete])
    renderScreen()

    const block = await screen.findByRole('region', { name: 'Drafts' })
    fireEvent.click(within(block).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'New transaction' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(screen.getByRole('region', { name: 'Drafts' })).getByText('Food · Esselunga')).toBeInTheDocument()
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('approves, opens the form on a 422, and edits in Italian under locale it', async () => {
    fetchDraftsMock.mockResolvedValue([complete, bare])
    renderScreen('it')

    const block = await screen.findByRole('region', { name: 'Bozze' })
    const rows = within(block).getAllByRole('listitem')
    expect(within(rows[0]).getByRole('button', { name: 'Approva' })).toBeInTheDocument()
    expect(within(rows[0]).getByRole('button', { name: 'Modifica' })).toBeInTheDocument()

    // One tap.
    approveMock.mockResolvedValueOnce(approved)
    fetchDraftsMock.mockResolvedValue([bare])
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Approva' }))
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('', 10))
    await waitFor(() =>
      expect(within(screen.getByRole('region', { name: 'Bozze' })).queryByText('Food · Esselunga')).not.toBeInTheDocument(),
    )

    // The 422 opens the Italian form with the rule message.
    approveMock.mockRejectedValueOnce(new ApiError('An amount is required', 422))
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Approva' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Nuova transazione' })).toBeInTheDocument()
    expect(within(dialog).getByText('An amount is required')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Descrizione')).toHaveValue('something at the bar')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // A failure that is not a rule error reads in Italian.
    approveMock.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(within(screen.getByRole('region', { name: 'Bozze' })).getByRole('button', { name: 'Approva' }))
    expect(await screen.findByText('Impossibile approvare la bozza.')).toBeInTheDocument()

    // Edit opens the Italian form directly, pre-filled, and its Save goes
    // through Approve with the edited payload.
    fireEvent.click(within(screen.getByRole('region', { name: 'Bozze' })).getByRole('button', { name: 'Modifica' }))
    const editDialog = await screen.findByRole('dialog')
    expect(within(editDialog).getByRole('heading', { name: 'Nuova transazione' })).toBeInTheDocument()
    expect(within(editDialog).getByLabelText('Descrizione')).toHaveValue('something at the bar')
    expect(within(editDialog).getByLabelText('Importo (€)')).toHaveValue('')
    approveMock.mockResolvedValueOnce({ ...approved, id: 3, amount: '7.50', category_id: null })
    fetchDraftsMock.mockResolvedValue([])
    fireEvent.change(within(editDialog).getByLabelText('Importo (€)'), { target: { value: '7,5' } })
    fireEvent.change(within(editDialog).getByLabelText('Data'), { target: { value: '2026-11-18' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Salva transazione' }))
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith('', 11, bareEdited))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Bozze' })).not.toBeInTheDocument()
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
