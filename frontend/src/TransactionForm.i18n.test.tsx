/** i18n Transaction form tests (issue #117): field labels, buttons, and
 * validation errors render in Italian under Locale `it`, English under
 * `en`, with English as the fallback for any untranslated key. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { TransactionForm } from './TransactionForm'
import { renderWithIntl } from './test/renderWithIntl'
import type { Category, Transaction, Wallet } from './api'

vi.mock('./api', () => ({
  TOKEN_KEY: 'budjetame.token',
  ApiError: class ApiError extends Error {},
  apiErrorMessage: (_error: unknown, conflict: string, fallback: string) =>
    conflict || fallback,
  formatEuros: (value: string) => `€${value}`,
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))

vi.mock('./MapPicker', () => ({
  MapPicker: () => null,
}))

import { createTransaction } from './api'

const createTransactionMock = vi.mocked(createTransaction)

const createdAt = '2026-08-01T10:00:00Z'

const wallets: Wallet[] = [
  { id: 1, name: 'Intesa', type: 'checking', balance: '1200.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Contanti', type: 'cash', balance: '300.00', frozen: false, created_at: createdAt },
]

const categories: Category[] = [
  { id: 1, name: 'Food', icon: '🍕', type: 'expense', color: '#ef4444', created_at: createdAt },
]

const base: Transaction = {
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
}

function renderForm(locale: string, editing: Transaction | null = null) {
  return renderWithIntl(
    <TransactionForm
      wallets={wallets}
      categories={categories}
      recurringCosts={[]}
      recurringIncomes={[]}
      editing={editing}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
      onCancel={vi.fn()}
      onAddCategory={() => {}}
      categoryToSelect={null}
      onAddWallet={() => {}}
      walletToSelect={null}
      onAddRecurringCost={() => {}}
      recurringCostToSelect={null}
      onAddRecurringIncome={() => {}}
      recurringIncomeToSelect={null}
    />,
    { locale },
  )
}

describe('TransactionForm i18n (issue #117)', () => {
  it('renders English labels under locale en', () => {
    renderForm('en')

    expect(screen.getByText('New transaction')).toBeInTheDocument()
    expect(screen.getByText('Amount (€)')).toBeInTheDocument()
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Location')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save transaction' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders Italian labels under locale it', () => {
    renderForm('it')

    expect(screen.getByText('Nuova transazione')).toBeInTheDocument()
    expect(screen.getByText('Importo (€)')).toBeInTheDocument()
    expect(screen.getByText('Data')).toBeInTheDocument()
    expect(screen.getByText('Descrizione')).toBeInTheDocument()
    expect(screen.getByText('Posizione')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salva transazione' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument()
  })

  it('renders Italian validation errors under locale it', () => {
    renderForm('it')

    // Clear the amount and submit: an empty amount is its own Field Error.
    const amount = screen.getByLabelText('Importo (€)') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salva transazione' }))

    expect(screen.getByText('Inserisci un importo')).toBeInTheDocument()
    expect(createTransactionMock).not.toHaveBeenCalled()
  })

  it('renders Italian edit-title and delete button under locale it', () => {
    renderForm('it', { ...base, id: 9 })

    expect(screen.getByText('Modifica transazione')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Elimina transazione' })).toBeInTheDocument()
  })

  it('falls back to English for untranslated keys', () => {
    renderForm('de')

    expect(screen.getByText('New transaction')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save transaction' })).toBeInTheDocument()
  })
})
