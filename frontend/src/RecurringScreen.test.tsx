/** Recurring screen toggle (issue #60): the Recurring tab offers Costs |
 * Incomes — default Costs — and the last side is remembered for the app
 * session, surviving tab switches (reset on app load). The Costs side
 * renders exactly as before; the Incomes side mirrors it. The API client is
 * mocked; both sides' loads are stubbed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { RecurringScreen } from './RecurringScreen'
import { setRecurringSide } from './recurringSide'
import type { RecurringCost, RecurringIncome } from './api'

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
    fetchRecurringIncomes: vi.fn(),
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    deleteRecurringIncome: vi.fn(),
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
  }
})

import { fetchRecurringCosts, fetchRecurringIncomes } from './api'

const createdAt = '2026-08-20T10:00:00Z'

const cost: RecurringCost = {
  id: 1,
  name: 'Rent',
  amount: '850.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2026-09-01',
  next_due_date: '2026-09-01',
  next_unpaid_occurrence_date: '2026-09-01',
  backlog_count: 0,
  next_skip_action: 'skip',
  created_at: createdAt,
}

const income: RecurringIncome = {
  id: 1,
  name: 'Salary',
  amount: '2100.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2026-09-01',
  next_due_date: '2026-09-27',

  next_unpaid_occurrence_date: '2026-09-27',
  backlog_count: 0,
  next_skip_action: 'skip',
  created_at: createdAt,
}

const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)

beforeEach(() => {
  // The session memory resets on app load; each test starts from the Costs
  // default (the module value is shared across tests in this file).
  setRecurringSide('costs')
  fetchRecurringCostsMock.mockResolvedValue([cost])
  fetchRecurringIncomesMock.mockResolvedValue([income])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringScreen toggle', () => {
  it('defaults to the Costs side', async () => {
    render(<RecurringScreen />)

    expect(await screen.findByRole('button', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New recurring income' })).not.toBeInTheDocument()
    // The toggle itself marks the Costs side active.
    expect(screen.getByRole('button', { name: 'Costs' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Incomes' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('switching to Incomes renders the incomes side and back to Costs the costs side', async () => {
    render(<RecurringScreen />)
    await screen.findByRole('button', { name: 'New recurring cost' })

    fireEvent.click(screen.getByRole('button', { name: 'Incomes' }))
    expect(await screen.findByRole('button', { name: 'New recurring income' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New recurring cost' })).not.toBeInTheDocument()
    expect(screen.getByText('Salary')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Costs' }))
    expect(await screen.findByRole('button', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New recurring income' })).not.toBeInTheDocument()
    expect(screen.getByText('Rent')).toBeInTheDocument()
  })

  it('remembers the last side across the screen unmounting (tab switch)', async () => {
    // First mount: switch to Incomes, then unmount — as a tab switch would.
    const first = render(<RecurringScreen />)
    await screen.findByRole('button', { name: 'New recurring cost' })
    fireEvent.click(screen.getByRole('button', { name: 'Incomes' }))
    await screen.findByRole('button', { name: 'New recurring income' })
    first.unmount()

    // The session memory survives: a fresh mount lands on Incomes, not the
    // Costs default.
    render(<RecurringScreen />)
    expect(await screen.findByRole('button', { name: 'New recurring income' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New recurring cost' })).not.toBeInTheDocument()
  })

  it('only fetches the side it renders', async () => {
    render(<RecurringScreen />)
    await screen.findByRole('button', { name: 'New recurring cost' })
    expect(fetchRecurringCostsMock).toHaveBeenCalled()
    expect(fetchRecurringIncomesMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Incomes' }))
    await waitFor(() => expect(fetchRecurringIncomesMock).toHaveBeenCalled())
  })
})
