/** The Transaction form's two Draft-flow capabilities (issue #124, ADR-0036):
 * it starts from partial initial values — the Transaction's field names,
 * any of them missing, type and amount included — rendering what is there
 * and revealing a Field Error on what is left at Save; and it hands its
 * validated payload to a caller-supplied save instead of its own create or
 * update call when one is given, so a Draft Transaction can open pre-filled
 * and its Save can go through Approve. The API client and the map picker
 * are mocked. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithIntl } from './test/renderWithIntl'

import { TransactionForm, type TransactionInitialValues } from './TransactionForm'
import type { Category, Transaction, TransactionInput, Wallet } from './api'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  TOKEN_KEY: 'budjetame.token',
  apiErrorMessage: (error: { message: string }) => error.message,
  formatEuros: (value: string) => `€${value}`,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import { ApiError, createTransaction, updateTransaction } from './api'

const createTransactionMock = vi.mocked(createTransaction)
const updateTransactionMock = vi.mocked(updateTransaction)

const createdAt = '2026-08-01T10:00:00Z'

const wallets: Wallet[] = [
  { id: 1, name: 'Cash', type: 'cash', balance: '100.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Checking', type: 'checking', balance: '200.00', frozen: false, created_at: createdAt },
  { id: 3, name: 'Marco', type: 'contact', balance: '0.00', frozen: false, created_at: createdAt },
]

const categories: Category[] = [
  { id: 1, name: 'Food', icon: '🍕', type: 'expense', color: '#ef4444', created_at: createdAt },
  { id: 2, name: 'Salary', icon: '💼', type: 'income', color: '#22c55e', created_at: createdAt },
]

const created: Transaction = {
  id: 42,
  type: 'expense',
  amount: '12.50',
  date: '2026-11-10',
  wallet_id: 2,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: 1,
  recurring_cost_id: null,
  recurring_income_id: null,
  occurrence_date: null,
  description: 'Lunch',
  latitude: null,
  longitude: null,
  place_name: null,
  place_id: null,
  warning: false,
  created_at: createdAt,
}

beforeEach(() => {
  createTransactionMock.mockReset()
  createTransactionMock.mockResolvedValue({ ...created })
  updateTransactionMock.mockReset()
  updateTransactionMock.mockResolvedValue({ ...created })
})

function renderForm({
  initialValues = null,
  editing = null,
  save,
  onSaved = () => {},
  wallets: offered = wallets,
}: {
  initialValues?: TransactionInitialValues | null
  editing?: Transaction | null
  save?: (input: TransactionInput) => Promise<Transaction>
  onSaved?: (transaction: Transaction) => void
  wallets?: Wallet[]
}) {
  return renderWithIntl(
    <TransactionForm
      wallets={offered}
      categories={categories}
      recurringCosts={[]}
      recurringIncomes={[]}
      editing={editing}
      initialValues={initialValues}
      save={save}
      onSaved={onSaved}
      onDeleted={() => {}}
      onCancel={() => {}}
      onAddCategory={() => {}}
      categoryToSelect={null}
      onAddWallet={() => {}}
      walletToSelect={null}
      onAddRecurringCost={() => {}}
      recurringCostToSelect={null}
      onAddRecurringIncome={() => {}}
      recurringIncomeToSelect={null}
    />,
  )
}

const saveButton = () => screen.getByRole('button', { name: 'Save transaction' })

const optionLabels = (label: string) =>
  Array.from(screen.getByLabelText(label).querySelectorAll('option')).map(
    (option) => option.textContent,
  )

describe('TransactionForm partial initial values (issue #124)', () => {
  it('renders what the seed carries, leaves the rest empty, and reveals a Field Error on it at Save', () => {
    // An Income the Assistant heard without an amount or a date: the
    // fields it did catch are pre-filled; the missing ones stay empty
    // instead of taking the create defaults, and Save points at them.
    renderForm({
      initialValues: {
        type: 'income',
        amount: null,
        date: null,
        wallet_id: 2,
        category_id: 2,
        description: 'Salary',
      },
    })

    // The seeded type shows through what it governs: the Income pickers.
    expect(optionLabels('Category')).toEqual(['None', '💼 Salary', '＋ Add category…'])
    expect(optionLabels('Wallet')).toEqual([
      'Cash (€100.00)',
      'Checking (€200.00)',
      '＋ Add wallet…',
    ])
    expect(screen.getByLabelText('Amount (€)')).toHaveValue('')
    expect(screen.getByLabelText('Date')).toHaveValue('')
    expect(screen.getByLabelText('Wallet')).toHaveValue('2')
    expect(screen.getByLabelText('Category')).toHaveValue('2')
    expect(screen.getByLabelText('Description')).toHaveValue('Salary')
    // A seed is not an edit: the type and the Wallet stay changeable, the
    // title is the create one, and there is nothing to delete.
    expect(screen.getByRole('button', { name: 'Income' })).toBeEnabled()
    expect(screen.getByLabelText('Wallet')).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'New transaction' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete transaction' })).not.toBeInTheDocument()

    fireEvent.click(saveButton())

    expect(screen.getByText('Enter an amount')).toBeInTheDocument()
    expect(screen.getByText('Choose a date')).toBeInTheDocument()
    expect(screen.queryByText('Choose a wallet.')).not.toBeInTheDocument()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('initial values without a type open as an Expense, and a Wallet the picker cannot offer gives way to the default', () => {
    // No type and a frozen Wallet (ADR-0002), which the picker never
    // lists: the form starts the way a new Transaction does — Expense,
    // first active Wallet — keeping the amount the initial values carry.
    renderForm({
      initialValues: { amount: '12.50', wallet_id: 4 },
      wallets: [
        { id: 4, name: 'Old card', type: 'checking', balance: '0.00', frozen: true, created_at: createdAt },
        ...wallets,
      ],
    })

    expect(optionLabels('Category')).toEqual(['None', '🍕 Food', '＋ Add category…'])
    expect(screen.getByLabelText('Amount (€)')).toHaveValue('12.50')
    expect(screen.getByLabelText('Wallet')).toHaveValue('1')
  })

  it('a missing Wallet takes the create default, the one field a required select cannot show empty', () => {
    renderForm({ initialValues: { type: 'expense', amount: '3.00', wallet_id: null } })

    expect(screen.getByLabelText('Wallet')).toHaveValue('1')
    fireEvent.click(saveButton())
    expect(screen.queryByText('Choose a wallet.')).not.toBeInTheDocument()
  })

  it('a Transfer with one leg keeps it and defaults the other, so Save can still flag a same-Wallet pair', () => {
    renderForm({
      initialValues: { type: 'transfer', amount: '50', source_wallet_id: 2, destination_wallet_id: null },
    })

    expect(screen.getByLabelText('From')).toHaveValue('2')
    // The default destination is the second active Wallet: the very one
    // the seeded source names, which Save catches.
    expect(screen.getByLabelText('To')).toHaveValue('2')
    fireEvent.click(saveButton())
    expect(screen.getAllByText('Source and destination must be different wallets.')).toHaveLength(2)
    expect(createTransactionMock).not.toHaveBeenCalled()
  })
})

describe('TransactionForm caller-supplied save (issue #124)', () => {
  it('hands the validated payload to the supplied save instead of the create call, and reports its result', async () => {
    const save = vi.fn<(input: TransactionInput) => Promise<Transaction>>()
    save.mockResolvedValue(created)
    const onSaved = vi.fn()
    renderForm({
      initialValues: {
        type: 'expense',
        amount: '12,5',
        date: '2026-11-10',
        wallet_id: 2,
        category_id: 1,
        description: 'Lunch',
      },
      save,
      onSaved,
    })

    fireEvent.click(saveButton())

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created))
    // The payload is the one the form's own create would have sent: the
    // tolerant amount canonicalized (ADR-0029), the links null.
    expect(save).toHaveBeenCalledWith({
      type: 'expense',
      amount: '12.50',
      date: '2026-11-10',
      walletId: 2,
      categoryId: 1,
      recurringCostId: null,
      recurringIncomeId: null,
      description: 'Lunch',
      latitude: null,
      longitude: null,
      place_name: null,
      place_id: null,
    })
    expect(createTransactionMock).not.toHaveBeenCalled()
    expect(updateTransactionMock).not.toHaveBeenCalled()
  })

  it('a rejected save keeps the form open with its message in the error banner', async () => {
    // Approve's rule errors answer 422 with the message as detail
    // (ADR-0036); they land in the banner like any server rejection, and
    // the form stays for another try.
    const save = vi.fn<(input: TransactionInput) => Promise<Transaction>>()
    save.mockRejectedValue(new ApiError('Wallet "Old card" is frozen', 422))
    const onSaved = vi.fn()
    renderForm({
      initialValues: { type: 'expense', amount: '12.50', date: '2026-11-10', wallet_id: 2 },
      save,
      onSaved,
    })

    fireEvent.click(saveButton())

    expect(await screen.findByText('Wallet "Old card" is frozen')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
    expect(screen.getByLabelText('Amount (€)')).toHaveValue('12.50')
  })

  it('wins over the update call too while editing', async () => {
    const save = vi.fn<(input: TransactionInput) => Promise<Transaction>>()
    save.mockResolvedValue(created)
    const onSaved = vi.fn()
    renderForm({ editing: created, save, onSaved })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created))
    expect(save).toHaveBeenCalledTimes(1)
    expect(updateTransactionMock).not.toHaveBeenCalled()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })
})
