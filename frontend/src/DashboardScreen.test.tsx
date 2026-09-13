/** Dashboard cards: the Budget card (issues #66, #100) — the big Spendable
 * Today, the "Y this month (X per day)" frame line, the "X left this month"
 * line, the 0 + "X over today's budget" note when the bucket is negative
 * (the month's own over-note replaces it when the whole frame is blown), the
 * hide-when-no-Recurring-definitions rule — plus the
 * category pie and the trend, each toggling between Expenses and Incomes.
 * Loading and error states never look like an empty card. The API client is
 * mocked; the cards only render what the endpoints return — no computation
 * on the client. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { DashboardScreen } from './DashboardScreen'
import { todayInRome } from './transactions'
import type { BudgetView, CategoryExpense, RecurringCost, RecurringIncome } from './api'

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
    fetchTrend: vi.fn(),
    fetchBudget: vi.fn(),
    fetchRecurringCosts: vi.fn(),
    fetchRecurringIncomes: vi.fn(),
  }
})

import {
  fetchBudget,
  fetchDashboardSummary,
  fetchRecurringCosts,
  fetchRecurringIncomes,
  fetchTrend,
} from './api'

const fetchDashboardSummaryMock = vi.mocked(fetchDashboardSummary)
const fetchTrendMock = vi.mocked(fetchTrend)
const fetchBudgetMock = vi.mocked(fetchBudget)
const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)

/** The card always shows the current Europe/Rome month (issue #66). */
const currentMonth = todayInRome().slice(0, 7)

/** A positive Budget: 500 € monthly spendable (2,100 € income − 850 €
 * costs), 16,60 € per day, 49,80 € in the bucket — the card renders
 * these values back as-is. */
const budget: BudgetView = {
  month: currentMonth,
  monthly_spendable: '500.00',
  recurring_incomes_total: '2100.00',
  recurring_costs_total: '850.00',
  daily_allowance: '16.60',
  spendable_today: '49.80',
  remaining_monthly_spendable: '333.40',
}

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
  created_at: createdAt,
}

/** The two pies: one slice each, distinct enough that no assertion can
 * collide with the Budget card's euros. */
const expenseSlice: CategoryExpense = {
  category_id: 1,
  name: 'Food',
  icon: '🍕',
  color: '#ef4444',
  amount: '100.00',
}

const incomeSlice: CategoryExpense = {
  category_id: 2,
  name: 'Salary',
  icon: '💰',
  color: '#10b981',
  amount: '200.00',
}

/** The trend card's default range: five months before the current one. */
function monthsAgo(count: number): string {
  const [year, month] = currentMonth.split('-').map(Number)
  const total = year * 12 + (month - 1) - count
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`
}

const trendFromMonth = monthsAgo(5)

beforeEach(() => {
  // The summary and trend echo the requested months so the dashboard's
  // loaded-state guards pass; the numbers are distinct so no assertion
  // collides with the Budget card's euros.
  fetchDashboardSummaryMock.mockImplementation(async (_token, month) => ({
    month: month ?? '',
    net_worth: '1000.00',
    income: '3000.00',
    expenses: '1500.00',
    expenses_by_category: [expenseSlice],
    incomes_by_category: [incomeSlice],
  }))
  fetchTrendMock.mockImplementation(async (_token, _kind, fromMonth, toMonth) => ({
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
  it('renders the big Spendable Today and the frame line with recurring breakdown from the endpoint', async () => {
    render(<DashboardScreen />)

    expect(await screen.findByText('€49.80')).toBeInTheDocument()
    expect(
      screen.getByText('€500.00 this month (€2100.00 income − €850.00 costs) · €16.60 per day'),
    ).toBeInTheDocument()
    expect(fetchBudgetMock).toHaveBeenCalledWith('', currentMonth)
  })

  it('renders the Remaining Monthly Spendable line from the endpoint', async () => {
    render(<DashboardScreen />)

    expect(await screen.findByText('€333.40 left this month')).toBeInTheDocument()
  })

  it('shows 0 and an "over today\'s budget" note when the bucket is negative', async () => {
    fetchBudgetMock.mockResolvedValue({ ...budget, spendable_today: '-12.34' })
    render(<DashboardScreen />)

    expect(await screen.findByText('€0.00')).toBeInTheDocument()
    expect(screen.getByText("€12.34 over today's budget")).toBeInTheDocument()
  })

  it("shows the month's overage instead of the bucket note when the month is negative", async () => {
    fetchBudgetMock.mockResolvedValue({
      ...budget,
      spendable_today: '-433.40',
      remaining_monthly_spendable: '-100.00',
    })
    render(<DashboardScreen />)

    expect(
      await screen.findByText("€100.00 over this month's budget"),
    ).toBeInTheDocument()
    // The bucket's own over-note is transient — future accruals repay part
    // of it — so when the whole month is blown the month's bottom line
    // replaces it, never both. The big number still floors at 0.
    expect(screen.getByText('€0.00')).toBeInTheDocument()
    expect(screen.queryByText("€433.40 over today's budget")).not.toBeInTheDocument()
    expect(screen.queryByText(/left this month/)).not.toBeInTheDocument()
  })

  it('keeps the bucket note when only the bucket is negative', async () => {
    fetchBudgetMock.mockResolvedValue({
      ...budget,
      spendable_today: '-33.40',
      remaining_monthly_spendable: '300.00',
    })
    render(<DashboardScreen />)

    expect(await screen.findByText("€33.40 over today's budget")).toBeInTheDocument()
    expect(screen.getByText('€300.00 left this month')).toBeInTheDocument()
  })

  it('is hidden when the account has no Recurring definitions at all', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    fetchRecurringIncomesMock.mockResolvedValue([])
    render(<DashboardScreen />)

    await screen.findByText('Net Worth')
    // The card must not render — not even an all-zero shell.
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

  it('ignores the pie-month selector — the budget card has its own month selector', async () => {
    render(<DashboardScreen />)
    await screen.findByText('€49.80')

    const pieMonthInput = document.getElementById('pie-month') as HTMLInputElement
    fireEvent.change(pieMonthInput, { target: { value: '2020-01' } })

    // The budget card keeps its data and is not asked again just because
    // the pie month changed — only its own selector refetches it.
    expect(screen.getByText('€49.80')).toBeInTheDocument()
    expect(
      screen.getByText('€500.00 this month (€2100.00 income − €850.00 costs) · €16.60 per day'),
    ).toBeInTheDocument()
    expect(fetchBudgetMock).toHaveBeenCalledTimes(1)
  })
})

describe('Dashboard category pie', () => {
  it('shows the expense pie by default and its center label', async () => {
    render(<DashboardScreen />)

    expect(await screen.findByText(/Expenses by Category/)).toBeInTheDocument()
    expect(screen.getByText('🍕 Food')).toBeInTheDocument()
    expect(screen.getByText('€100.00 · 100%')).toBeInTheDocument()
    expect(screen.getByLabelText('Expenses by category')).toBeInTheDocument()
    // The pie's center is the expense total, not the income total.
    expect(screen.getByText('€1500.00')).toBeInTheDocument()
    expect(fetchDashboardSummaryMock).toHaveBeenCalledWith('', currentMonth)
  })

  it('toggles to the income pie without refetching the summary', async () => {
    render(<DashboardScreen />)
    await screen.findByText(/Expenses by Category/)

    fireEvent.click(within(screen.getByRole('group', { name: 'Pie side' })).getByRole('button', { name: 'Incomes' }))

    expect(await screen.findByText(/Incomes by Category/)).toBeInTheDocument()
    expect(screen.getByText('💰 Salary')).toBeInTheDocument()
    expect(screen.getByText('€200.00 · 100%')).toBeInTheDocument()
    expect(screen.getByLabelText('Incomes by category')).toBeInTheDocument()
    expect(screen.getByText('€3000.00')).toBeInTheDocument()
    expect(screen.queryByText('🍕 Food')).not.toBeInTheDocument()
    // Both pies ride on the same summary — one fetch.
    expect(fetchDashboardSummaryMock).toHaveBeenCalledTimes(1)
  })

  it('has its own month selector inside the card and refetches the summary for the chosen month', async () => {
    render(<DashboardScreen />)
    await screen.findByText(/Expenses by Category/)
    expect(fetchDashboardSummaryMock).toHaveBeenCalledWith('', currentMonth)

    const monthInput = document.getElementById('pie-month') as HTMLInputElement
    fireEvent.change(monthInput, { target: { value: '2020-01' } })

    // The summary is asked again for the new month; the pie waits for it
    // instead of showing the old month under the new title (US27).
    expect(fetchDashboardSummaryMock).toHaveBeenCalledWith('', '2020-01')
    expect(await screen.findByText(/Expenses by Category/)).toBeInTheDocument()
    // Net Worth never depends on the month — balances are current — so it
    // keeps rendering while the pie reloads.
    expect(screen.getByText('€1000.00')).toBeInTheDocument()
  })

  it('shows the empty state per side', async () => {
    fetchDashboardSummaryMock.mockImplementation(async (_token, month) => ({
      month: month ?? '',
      net_worth: '1000.00',
      income: '3000.00',
      expenses: '1500.00',
      expenses_by_category: [expenseSlice],
      incomes_by_category: [],
    }))
    render(<DashboardScreen />)
    await screen.findByText(/Expenses by Category/)

    fireEvent.click(within(screen.getByRole('group', { name: 'Pie side' })).getByRole('button', { name: 'Incomes' }))

    expect(await screen.findByText(/No incomes recorded in/)).toBeInTheDocument()
  })
})

describe('Dashboard trend', () => {
  it("fetches the expense trend; tapping a bar floats its amount chip above it", async () => {
    fetchTrendMock.mockImplementation(async (_token, _kind, fromMonth, toMonth) => ({
      from_month: fromMonth,
      to_month: toMonth,
      months: [{ month: '2026-03', amount: '42.00' }],
    }))
    render(<DashboardScreen />)

    expect(await screen.findByText(/Expenses Trend ·/)).toBeInTheDocument()
    expect(fetchTrendMock).toHaveBeenCalledWith('', 'expense', trendFromMonth, currentMonth)

    // The bars carry no always-on labels (they crowded the chart): the
    // exact amount is read by tapping the column — the value chip shows
    // the amount alone, never the old "Month · €amount" readout line.
    fireEvent.click(screen.getByRole('button', { name: /€42.00/ }))
    expect(await screen.findByText('€42.00')).toBeInTheDocument()
    expect(screen.queryByText('March 2026 · €42.00')).not.toBeInTheDocument()
  })

  it('toggles to the income trend and refetches with the new kind', async () => {
    fetchTrendMock.mockImplementation(async (_token, kind, fromMonth, toMonth) => ({
      from_month: fromMonth,
      to_month: toMonth,
      months: [{ month: '2026-03', amount: kind === 'income' ? '77.00' : '42.00' }],
    }))
    render(<DashboardScreen />)
    await screen.findByText(/Expenses Trend ·/)
    expect(fetchTrendMock).toHaveBeenCalledWith('', 'expense', trendFromMonth, currentMonth)

    fireEvent.click(within(screen.getByRole('group', { name: 'Trend side' })).getByRole('button', { name: 'Incomes' }))

    expect(await screen.findByText(/Incomes Trend ·/)).toBeInTheDocument()
    expect(fetchTrendMock).toHaveBeenCalledWith('', 'income', trendFromMonth, currentMonth)
    // The income bar's total is read on tap, like the expense side's.
    fireEvent.click(screen.getByRole('button', { name: /€77.00/ }))
    expect(await screen.findByText('€77.00')).toBeInTheDocument()
  })

  it('tapping the same column again hides the chip', async () => {
    fetchTrendMock.mockImplementation(async (_token, _kind, fromMonth, toMonth) => ({
      from_month: fromMonth,
      to_month: toMonth,
      months: [{ month: '2026-03', amount: '42.00' }],
    }))
    render(<DashboardScreen />)
    await screen.findByText(/Expenses Trend ·/)

    const bar = screen.getByRole('button', { name: /€42.00/ })
    fireEvent.click(bar)
    expect(await screen.findByText('€42.00')).toBeInTheDocument()
    fireEvent.click(bar)
    await waitFor(() => expect(screen.queryByText('€42.00')).not.toBeInTheDocument())
  })

  it('the column target paints above the bar, so tapping the bar itself selects', async () => {
    fetchTrendMock.mockImplementation(async (_token, _kind, fromMonth, toMonth) => ({
      from_month: fromMonth,
      to_month: toMonth,
      months: [{ month: '2026-03', amount: '42.00' }],
    }))
    render(<DashboardScreen />)
    await screen.findByText(/Expenses Trend ·/)

    // jsdom does no hit-testing, but the invariant is SVG paint order: an
    // SVG tap lands on the topmost painted element, so the transparent
    // column target must be the last (topmost) rect of its group — a tap
    // on the coloured bar underneath it then hits the target (issue #97).
    const column = screen.getByRole('button', { name: /€42.00/ })
    const group = column.parentElement
    expect(group).not.toBeNull()
    const rects = group!.querySelectorAll('rect')
    expect(rects.length).toBeGreaterThanOrEqual(2)
    expect(rects[rects.length - 1]).toBe(column)
  })

  it('a zero month\'s stub shows its €0.00 chip the same way', async () => {
    fetchTrendMock.mockImplementation(async (_token, _kind, fromMonth, toMonth) => ({
      from_month: fromMonth,
      to_month: toMonth,
      months: [
        { month: '2026-03', amount: '42.00' },
        { month: '2026-04', amount: '0.00' },
      ],
    }))
    render(<DashboardScreen />)
    await screen.findByText(/Expenses Trend ·/)

    fireEvent.click(screen.getByRole('button', { name: /April 2026: €0.00/ }))
    expect(await screen.findByText('€0.00')).toBeInTheDocument()
  })

  it('shows an error state on a failed trend load', async () => {
    fetchTrendMock.mockRejectedValue(new Error('network down'))
    render(<DashboardScreen />)

    expect(await screen.findByText('Could not load the trend.')).toBeInTheDocument()
  })
})
