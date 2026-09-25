/**
 * i18n Dashboard screen tests (issue #117): core-screen strings render in
 * Italian under Locale `it`, English under `en`, with English as the
 * fallback for any untranslated key.
 *
 * The component seam wraps DashboardScreen in IntlProvider (via
 * renderWithIntl) and uses setLocale() from the format module so the
 * number/date helpers agree with the message locale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { DashboardScreen } from './DashboardScreen'
import { renderWithIntl } from './test/renderWithIntl'
import { todayInRome } from './transactions'
import { setLocale } from './api/format'
import type { BudgetView } from './api'

vi.mock('./api', async () => {
  const { formatEuros, formatMonth, formatShortMonth } = await import('./api/format')
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
        ? error.status === 409 ? conflict : fallback
        : fallback,
    formatEuros,
    formatMonth,
    formatShortMonth,
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

const currentMonth = todayInRome().slice(0, 7)

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

const cost = {
  id: 1,
  name: 'Rent',
  amount: '850.00',
  interval_value: 1,
  interval_unit: 'months' as const,
  start_date: '2026-09-01',
  next_due_date: '2026-09-01',
  next_unpaid_occurrence_date: '2026-09-01',
  backlog_count: 0,
  frozen: false,
  created_at: createdAt,
}

const income = {
  id: 1,
  name: 'Salary',
  amount: '2100.00',
  interval_value: 1,
  interval_unit: 'months' as const,
  start_date: '2026-09-27',
  next_due_date: '2026-09-27',
  next_unpaid_occurrence_date: '2026-09-27',
  backlog_count: 0,
  frozen: false,
  created_at: createdAt,
}

beforeEach(() => {
  fetchDashboardSummaryMock.mockResolvedValue({
    month: currentMonth,
    net_worth: '5000.00',
    expenses: '1200.00',
    income: '2100.00',
    expenses_by_category: [
      { category_id: 1, name: 'Food', icon: '🍕', amount: '500.00', color: '#ef4444' },
      { category_id: 2, name: 'Transport', icon: '🚌', amount: '300.00', color: '#3b82f6' },
    ],
    incomes_by_category: [
      { category_id: 3, name: 'Salary', icon: '💼', amount: '2100.00', color: '#22c55e' },
    ],
  })
  fetchBudgetMock.mockResolvedValue(budget)
  fetchRecurringCostsMock.mockResolvedValue([cost])
  fetchRecurringIncomesMock.mockResolvedValue([income])
  fetchTrendMock.mockResolvedValue({
    from_month: currentMonth,
    to_month: currentMonth,
    months: [{ month: currentMonth, amount: '1200.00' }],
  })
})

afterEach(() => {
  setLocale('en')
})

describe('DashboardScreen i18n (issue #117)', () => {
  it('renders English strings under locale en', async () => {
    setLocale('en')
    renderWithIntl(<DashboardScreen />, { locale: 'en' })

    // Title — appears before async fetch
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    // Net Worth card — appears once summary loads
    expect(await screen.findByText('Net Worth')).toBeInTheDocument()
    // Budget card — appears once budget loads
    expect(await screen.findByText('Spendable Today')).toBeInTheDocument()
    // Pie category toggle
    expect(await screen.findByText(/Expenses by Category/)).toBeInTheDocument()
  })

  it('renders Italian strings under locale it', async () => {
    setLocale('it')
    renderWithIntl(<DashboardScreen />, { locale: 'it' })

    // Title — appears before async fetch
    expect(screen.getByText('Home')).toBeInTheDocument()
    // Net Worth card — appears once summary loads
    expect(await screen.findByText('Patrimonio netto')).toBeInTheDocument()
    // Budget card
    expect(await screen.findByText('Disponibile oggi')).toBeInTheDocument()
    // Pie category toggle uses Italian (partial match — heading includes the month)
    expect(await screen.findByText(/Spese per Categoria/)).toBeInTheDocument()
  })

  it('shows Italian Budget card strings under locale it', async () => {
    setLocale('it')
    renderWithIntl(<DashboardScreen />, { locale: 'it' })

    // Wait for the budget to load
    const budgetSection = await screen.findByText('Disponibile oggi')
    expect(budgetSection).toBeInTheDocument()

    // "this month" in Italian — may match multiple times
    expect(screen.getAllByText(/questo mese/).length).toBeGreaterThanOrEqual(1)
    // "per day" in Italian
    expect(screen.getByText(/al giorno/)).toBeInTheDocument()
    // "left this month" — use getAllByText as it may match multiple elements
    expect(screen.getAllByText(/rimanenti questo mese/).length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to English for untranslated keys', async () => {
    // Use 'de' (German) — no German catalog exists, so all keys fall back
    // to English because IntlProvider uses defaultLocale="en".
    setLocale('en')
    renderWithIntl(<DashboardScreen />, { locale: 'de' })

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(await screen.findByText('Spendable Today')).toBeInTheDocument()
  })

  it('shows Italian pie card labels under locale it', async () => {
    setLocale('it')
    renderWithIntl(<DashboardScreen />, { locale: 'it' })

    // Wait for the pie card (it loads with the summary)
    const pieHeading = await screen.findByText(/Spese per Categoria/)
    expect(pieHeading).toBeInTheDocument()

    // The kind toggle buttons — there may be multiple matches (heading + toggle)
    const expenseButtons = screen.getAllByText('Spese')
    expect(expenseButtons.length).toBeGreaterThanOrEqual(1)
  })
})