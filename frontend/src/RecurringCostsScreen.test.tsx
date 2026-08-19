/** Recurring Costs screen (issue #56): the list renders every cost sorted by
 * next due date, each row showing name, amount, interval, and the next due
 * date; create, edit, and delete live in a modal on this screen. The API
 * client is mocked; the real display helpers (interval text, euro
 * formatting) stay live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringCostsScreen } from './RecurringCostsScreen'
import type { Category, RecurringCost, Wallet } from './api'

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
    fetchRecurringCosts: vi.fn(),
    createRecurringCost: vi.fn(),
    updateRecurringCost: vi.fn(),
    deleteRecurringCost: vi.fn(),
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
  }
})

import {
  createRecurringCost,
  deleteRecurringCost,
  fetchCategories,
  fetchRecurringCosts,
  fetchWallets,
  updateRecurringCost,
} from './api'

const createdAt = '2026-08-19T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const costs: RecurringCost[] = [
  {
    id: 1,
    name: 'Rent',
    amount: '850.00',
    wallet_id: 1,
    category_id: 1,
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 1,
    due_month: null,
    next_due_date: '2026-09-01',
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Coffee',
    amount: '2.50',
    wallet_id: 1,
    category_id: null,
    interval_value: 5,
    interval_unit: 'days',
    start_date: null,
    due_day: null,
    due_month: null,
    next_due_date: '2026-08-20',
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Insurance',
    amount: '120.00',
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
  { id: 1, name: 'Housing', type: 'expense', icon: null, color: '#ef4444', created_at: createdAt },
  { id: 2, name: 'Salary', type: 'income', icon: null, color: '#10b981', created_at: createdAt },
]

const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const createRecurringCostMock = vi.mocked(createRecurringCost)
const updateRecurringCostMock = vi.mocked(updateRecurringCost)
const deleteRecurringCostMock = vi.mocked(deleteRecurringCost)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)

beforeEach(() => {
  fetchRecurringCostsMock.mockResolvedValue(costs)
  fetchWalletsMock.mockResolvedValue(wallets)
  fetchCategoriesMock.mockResolvedValue(categories)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringCostsScreen rows', () => {
  it('renders every cost sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Coffee'),
      expect.stringContaining('Rent'),
      expect.stringContaining('Insurance'),
    ])
    // Each row shows the amount and the interval with the next due date.
    const texts = rows.map((row) => row.textContent ?? '')
    expect(texts[0]).toContain('€2.50')
    expect(texts[0]).toContain('Every 5 days · next due 2026-08-20')
    expect(texts[1]).toContain('€850.00')
    expect(texts[1]).toContain('Every month · next due 2026-09-01')
    expect(texts[2]).toContain('€120.00')
    expect(texts[2]).toContain('Every year · next due 2026-12-01')
  })

  it('keeps the empty state when there are no costs', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    render(<RecurringCostsScreen />)

    expect(
      await screen.findByText("No recurring costs yet. Add your first one to track what's due."),
    ).toBeInTheDocument()
  })

  it('shows the load error when the list cannot be fetched', async () => {
    fetchRecurringCostsMock.mockRejectedValue(new Error('down'))
    render(<RecurringCostsScreen />)

    expect(
      await screen.findByText('Could not load your recurring costs.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringCostsScreen create flow', () => {
  it('creates a cost from the modal and lands it at its sorted position', async () => {
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
      amount: '45.00',
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
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
      target: { value: 'weeks' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))

    await waitFor(() =>
      expect(createRecurringCostMock).toHaveBeenCalledWith('', {
        name: 'Gym',
        amount: '45.00',
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
    expect(rows[1]).toContain('Gym')
  })

  it('offers only active non-Contact wallets and expense categories', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })

    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(
      Array.from(walletSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Intesa', 'Cash'])

    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    expect(
      Array.from(categorySelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['None', 'Housing'])
  })
})

describe('RecurringCostsScreen edit and delete flows', () => {
  it('edits a cost from its row and keeps it in the sorted list', async () => {
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      next_due_date: '2026-09-01',
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(850)
    expect(within(dialog).getByLabelText('Wallet')).toHaveValue('1')

    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRecurringCostMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ name: 'Rent', amount: '900.00' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rentRow = screen
      .getAllByRole('button')
      .find((row) => row.textContent?.includes('Rent'))
    expect(rentRow?.textContent).toContain('€900.00')
  })

  it('deletes a cost with the tap-again confirmation', async () => {
    deleteRecurringCostMock.mockResolvedValue(undefined)
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Coffee')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recurring cost' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringCostMock).toHaveBeenCalledWith('', 2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const third = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })
})
