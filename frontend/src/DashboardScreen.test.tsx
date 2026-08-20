/** Dashboard Budget card (issue #66): the big Spendable Today, the "per day ·
 * this month" line, the 0 + "you're X € over" note when the bucket is
 * negative, the hide-when-no-Recurring-definitions rule, and loading and
 * error states that never look like an empty Budget. The API client is
 * mocked; the card only renders what the endpoint returns — no computation
 * on the client. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DashboardScreen } from './DashboardScreen'
import { todayInRome } from './transactions'
import type { BudgetView, RecurringCost, RecurringIncome } from './api'

vi.mock('./api', async () => {
  const { formatEuros } = await import('./api/format')
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
    fetchDashboardSummary: vi.fn(),
    fetchExpenseTrend: vi.fn(),
    fetchBudget: vi.fn(),
    fetchRecurringCosts: vi.fn(),
    fetchRecurringIncomes: vi.fn(),
  }
})

import {
  fetchBudget,
  fetchDashboardSummary,
  fetchExpenseTrend,
  fetchRecurringCosts,
  fetchRecurringIncomes,
} from './api'

const fetchDashboardSummaryMock = vi.mocked(fetchDashboardSummary)
const fetchExpenseTrendMock = vi.mocked(fetchExpenseTrend)
const fetchBudgetMock = vi.mocked(fetchBudget)
const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)

/** The card always shows the current Europe/Rome month (issue #66). */
const currentMonth = todayInRome().slice(0, 7)

/** A positive Budget: 500 € monthly spendable, 16,60 € per day, 49,80 € in
 * the bucket — the card renders these values back as-is. */
const budget: BudgetView = {
  month: currentMonth,
  monthly_spendable: '500.00',
  daily_allowance: '16.60',
  spendable_today: '49.80',
}

const createdAt = '2026-08-20T10:00:00Z'

const cost: RecurringCost = {
  id: 1,
  name: 'Rent',
  amount: '850.00',
  wallet_id: 1,
  category_id: null,
  interval_value: 1,
  interval_unit: 'months',
  start_date: null,
  due_day: 1,
  due_month: null,
  next_due_date: '2026-09-01',
  next_unpaid_occurrence_date: '2026-09-01',
  backlog_count: 0,
  overdue: false,
  created_at: createdAt,
}

const income: RecurringIncome = {
  id: 1,
  name: 'Salary',
  amount: '2100.00',
  wallet_id: 1,
  category_id: null,
  interval_value: 1,
  interval_unit: 'months',
  start_date: null,
  due_day: 27,
  due_month: null,
  next_due_date: '2026-09-27',
  next_unpaid_occurrence_date: '2026-09-27',
  backlog_count: 0,
  overdue: false,
  created_at: createdAt,
}

beforeEach(() => {
  // The summary and trend echo the requested months so the dashboard's
  // loaded-state guards pass; the numbers are distinct so no assertion
  // collides with the Budget card's euros.
  fetchDashboardSummaryMock.mockImplementation(async (_token, month) => ({
    month: month ?? '',
    net_worth: '1000.00',
    income: '3000.00',
    expenses: '1500.00',
    expenses_by_category: [],
  }))
  fetchExpenseTrendMock.mockImplementation(async (_token, fromMonth, toMonth) => ({
    from_month: fromMonth,
    to_month: toMonth,
    months: [],
  }))
  fetchBudgetMock.mockResolvedValue(budget)
  // An account with definitions by default: the card only hides when both
  // lists are proven empty.
  fetchRecurringCostsMock.mockResolvedValue([cost])
  fetchRecurringIncomesMock.mockResolvedValue([income])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Dashboard Budget card', () => {
  it('renders the big Spendable Today and the per-day line from the endpoint', async () => {
    render(<DashboardScreen />)

    expect(await screen.findByText('€49.80')).toBeInTheDocument()
    expect(screen.getByText('€16.60 per day · €500.00 this month')).toBeInTheDocument()
    expect(fetchBudgetMock).toHaveBeenCalledWith('')
  })

  it('shows 0 and a "you\'re X € over" note when the bucket is negative', async () => {
    fetchBudgetMock.mockResolvedValue({ ...budget, spendable_today: '-12.34' })
    render(<DashboardScreen />)

    expect(await screen.findByText('€0.00')).toBeInTheDocument()
    expect(screen.getByText("You're €12.34 over")).toBeInTheDocument()
  })

  it('is hidden when the account has no Recurring definitions at all', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    fetchRecurringIncomesMock.mockResolvedValue([])
    render(<DashboardScreen />)

    await screen.findByText('Net Worth')
    // The card must not render — not even a "0,00 € per day" shell.
    await waitFor(() => {
      expect(screen.queryByText('Spendable Today')).not.toBeInTheDocument()
    })
    expect(screen.queryByText(/per day/)).not.toBeInTheDocument()
  })

  it('stays visible when only one side has definitions', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    fetchRecurringIncomesMock.mockResolvedValue([income])
    render(<DashboardScreen />)

    expect(await screen.findByText('€49.80')).toBeInTheDocument()
  })

  it('shows an error state on a failed load — never an empty Budget', async () => {
    fetchBudgetMock.mockRejectedValue(new Error('network down'))
    render(<DashboardScreen />)

    expect(await screen.findByText('Could not load the budget.')).toBeInTheDocument()
    expect(screen.queryByText(/per day/)).not.toBeInTheDocument()
    expect(screen.queryByText('€0.00')).not.toBeInTheDocument()
  })

  it('stays visible when the definitions check itself fails', async () => {
    fetchRecurringCostsMock.mockRejectedValue(new Error('network down'))
    fetchRecurringIncomesMock.mockRejectedValue(new Error('network down'))
    render(<DashboardScreen />)

    // A failed load must never look like an empty Budget: the card renders
    // the data it has instead of hiding.
    expect(await screen.findByText('€49.80')).toBeInTheDocument()
  })

  it('shows a loading state while the budget is in flight', async () => {
    let resolveBudget: (value: BudgetView) => void = () => {}
    fetchBudgetMock.mockReturnValue(
      new Promise((resolve) => {
        resolveBudget = resolve
      }),
    )
    render(<DashboardScreen />)

    await screen.findByText('Net Worth')
    expect(screen.getByText('Loading…')).toBeInTheDocument()

    resolveBudget(budget)
    expect(await screen.findByText('€49.80')).toBeInTheDocument()
  })

  it('ignores the reference-month selector — the card is current-month-only', async () => {
    render(<DashboardScreen />)
    await screen.findByText('€49.80')

    const monthInput = document.getElementById('dashboard-month') as HTMLInputElement
    fireEvent.change(monthInput, { target: { value: '2020-01' } })

    // The card keeps its data and the endpoint is not asked again.
    expect(screen.getByText('€49.80')).toBeInTheDocument()
    expect(screen.getByText('€16.60 per day · €500.00 this month')).toBeInTheDocument()
    expect(fetchBudgetMock).toHaveBeenCalledTimes(1)
  })
})
