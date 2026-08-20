/** Dashboard resource: summary and trends (issue #17). */

import { request } from './transport'

export type DashboardSummary = {
  net_worth: string
  month: string
  income: string
  expenses: string
  expenses_by_category: CategoryExpense[]
  /** The income pie for the same month — the mirror of the expense pie; the
   * pie card toggles between the two. */
  incomes_by_category: CategoryExpense[]
}

export type CategoryExpense = {
  category_id: number | null
  name: string
  icon: string | null
  // null for the "Uncategorized" slice — the frontend renders a neutral color
  color: string | null
  amount: string
}

export type MonthBucket = {
  month: string
  /** The bucket's total — Expenses for `kind: 'expense'`, Incomes for
   * `kind: 'income'`. */
  amount: string
}

export type TrendKind = 'expense' | 'income'

export type Trend = {
  from_month: string
  to_month: string
  months: MonthBucket[]
}

/** The Budget card (issue #66): the current Europe/Rome month's frame —
 * deliberately no month parameter, the Budget is current-month-only by
 * product decision. `spendable_today` is sent raw and may be negative;
 * the card renders it as 0 until future accruals repay the debt. */
export type BudgetView = {
  month: string
  monthly_spendable: string
  daily_allowance: string
  spendable_today: string
}

export async function fetchBudget(token: string): Promise<BudgetView> {
  const response = await request('/dashboard/budget', {
    token,
    errorMessage: 'Could not load the budget',
  })
  return (await response.json()) as BudgetView
}

export async function fetchDashboardSummary(
  token: string,
  month?: string,
): Promise<DashboardSummary> {
  const query = month !== undefined ? `?month=${month}` : ''
  const response = await request(`/dashboard/summary${query}`, {
    token,
    errorMessage: 'Could not load the dashboard',
  })
  return (await response.json()) as DashboardSummary
}

/** The trend over an inclusive month range (T12, US28): the frontend picks
 * the kind with the trend card's toggle — `expense` hits `/expense-trend`,
 * `income` hits `/income-trend`. */
export async function fetchTrend(
  token: string,
  kind: TrendKind,
  fromMonth: string,
  toMonth: string,
): Promise<Trend> {
  const response = await request(`/dashboard/${kind}-trend?from_month=${fromMonth}&to_month=${toMonth}`, {
    token,
    errorMessage: 'Could not load the trend',
  })
  return (await response.json()) as Trend
}
