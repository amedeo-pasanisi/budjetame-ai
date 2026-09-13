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

/** The Budget card (issue #66): a month's Budget frame — optionally
 * parameterised by `?month=YYYY-MM` (defaults to the current Europe/Rome
 * month). `monthly_spendable` is the Recurring Income Occurrences due in
 * the month minus the Recurring Cost Occurrences due in it, counted by
 * due date whether paid or not; `recurring_incomes_total` and
 * `recurring_costs_total` are the component totals (their difference is
 * `monthly_spendable`). `spendable_today` and
 * `remaining_monthly_spendable` are sent raw and may be negative: the
 * card renders the bucket as 0 until future accruals repay the debt. For
 * non-current months, "today" in the accrual and spending computation is
 * the last day of that month, so `spendable_today` and
 * `remaining_monthly_spendable` reflect the full month's final state. */
export type BudgetView = {
  month: string
  monthly_spendable: string
  recurring_incomes_total: string
  recurring_costs_total: string
  daily_allowance: string
  spendable_today: string
  /** The part of the month's frame not drained yet (issue #100): the
   * Monthly Spendable minus the Discretionary Expenses dated from the 1st
   * through today (or the month's last day for non-current months). Raw,
   * may be negative. */
  remaining_monthly_spendable: string
}

export async function fetchBudget(
  token: string,
  month?: string,
): Promise<BudgetView> {
  const query = month !== undefined ? `?month=${month}` : ''
  const response = await request(`/dashboard/budget${query}`, {
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
