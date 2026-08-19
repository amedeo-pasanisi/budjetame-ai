/** Recurring Incomes screen (issue #60): the Incomes side of the Recurring
 * tab renders every income sorted by next due date, each row showing name,
 * amount, interval, and the next due date (derived on the backend, override
 * applied). Create, edit, and delete live in a modal on this screen,
 * mirroring the Costs side (ADR-0011). The API client is mocked; the real
 * display helpers (interval text, euro formatting) stay live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringIncomesScreen } from './RecurringIncomesScreen'
import type { Category, RecurringIncome, Wallet } from './api'

vi.mock('./api', async () => {
  const { formatEuros, formatSignedEuros } = await import('./api/format')
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    TOKEN_KEY: 'budjetame.token',
    ApiError,
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError
        ? error.status === 409
          ? conflict
          : fallback
        : fallback,
    formatEuros,
    formatSignedEuros,
    fetchRecurringIncomes: vi.fn(),
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    deleteRecurringIncome: vi.fn(),
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
  }
})

import {
  createRecurringIncome,
  deleteRecurringIncome,
  fetchCategories,
  fetchRecurringIncomes,
  fetchWallets,
  updateRecurringIncome,
} from './api'

const createdAt = '2026-08-20T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const incomes: RecurringIncome[] = [
  {
    id: 1,
    name: 'Salary',
    amount: '2100.00',
    wallet_id: 1,
    category_id: 1,
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 27,
    due_month: null,
    next_due_date: '2026-09-27',
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Rent from Marco',
    amount: '600.00',
    wallet_id: 1,
    category_id: null,
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 1,
    due_month: null,
    next_due_date: '2026-09-01',
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Bonus',
    amount: '1500.00',
    wallet_id: 2,
    category_id: null,
    interval_value: 1,
    interval_unit: 'years',
    start_date: null,
    due_day: 1,
    due_month: 12,
    next_due_date: '2026-12-01',
    created_at: createdAt,
  },
]

const wallets: Wallet[] = [
  { id: 1, name: 'Intesa', type: 'checking', balance: '0.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Cash', type: 'cash', balance: '0.00', frozen: false, created_at: createdAt },
  { id: 3, name: 'Frozen', type: 'checking', balance: '0.00', frozen: true, created_at: createdAt },
  { id: 4, name: 'Marco', type: 'contact', balance: '0.00', frozen: false, created_at: createdAt },
]

const categories: Category[] = [
  { id: 1, name: 'Salary', type: 'income', icon: null, color: '#10b981', created_at: createdAt },
  { id: 2, name: 'Housing', type: 'expense', icon: null, color: '#ef4444', created_at: createdAt },
]

const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)
const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const updateRecurringIncomeMock = vi.mocked(updateRecurringIncome)
const deleteRecurringIncomeMock = vi.mocked(deleteRecurringIncome)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)

beforeEach(() => {
  fetchRecurringIncomesMock.mockResolvedValue(incomes)
  fetchWalletsMock.mockResolvedValue(wallets)
  fetchCategoriesMock.mockResolvedValue(categories)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringIncomesScreen rows', () => {
  it('renders every income sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Rent from Marco'),
      expect.stringContaining('Salary'),
      expect.stringContaining('Bonus'),
    ])
    // Each row shows the amount and the interval with the next due date.
    const texts = rows.map((row) => row.textContent ?? '')
    expect(texts[0]).toContain('€600.00')
    expect(texts[0]).toContain('Every month · next due 2026-09-01')
    expect(texts[1]).toContain('€2100.00')
    expect(texts[1]).toContain('Every month · next due 2026-09-27')
    expect(texts[2]).toContain('€1500.00')
    expect(texts[2]).toContain('Every year · next due 2026-12-01')
  })

  it('keeps the empty state when there are no incomes', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([])
    render(<RecurringIncomesScreen />)

    expect(
      await screen.findByText("No recurring incomes yet. Add your first one to track what's due."),
    ).toBeInTheDocument()
  })

  it('shows the load error when the list cannot be fetched', async () => {
    fetchRecurringIncomesMock.mockRejectedValue(new Error('down'))
    render(<RecurringIncomesScreen />)

    expect(
      await screen.findByText('Could not load your recurring incomes.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringIncomesScreen create flow', () => {
  it('creates an income from the modal and lands it at its sorted position', async () => {
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Freelance',
      amount: '800.00',
      wallet_id: 1,
      category_id: null,
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      created_at: createdAt,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '800.00' } })
    fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
      target: { value: 'weeks' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))

    await waitFor(() =>
      expect(createRecurringIncomeMock).toHaveBeenCalledWith('', {
        name: 'Freelance',
        amount: '800.00',
        walletId: 1,
        categoryId: null,
        intervalValue: 1,
        intervalUnit: 'weeks',
        startDate: null,
        dueDay: null,
        dueMonth: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
      .map((row) => row.textContent)
    expect(rows[0]).toContain('Freelance')
  })

  it('offers only active non-Contact wallets and income categories', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })

    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(
      Array.from(walletSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Intesa', 'Cash'])

    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    expect(
      Array.from(categorySelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['None', 'Salary'])
  })
})

describe('RecurringIncomesScreen edit and delete flows', () => {
  it('edits an income from its row and keeps it in the sorted list', async () => {
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      next_due_date: '2026-09-27',
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Salary')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(2100)
    expect(within(dialog).getByLabelText('Wallet')).toHaveValue('1')

    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ name: 'Salary', amount: '2200.00' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const salaryRow = screen
      .getAllByRole('button')
      .find((row) => row.textContent?.includes('Salary'))
    expect(salaryRow?.textContent).toContain('€2200.00')
  })

  it('deletes an income with the tap-again confirmation', async () => {
    deleteRecurringIncomeMock.mockResolvedValue(undefined)
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Bonus')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recurring income' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringIncomeMock).toHaveBeenCalledWith('', 3))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Bonus')).not.toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const third = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
  })
})
