/** Dashboard resource: summary and expense trend (issue #17). */

import { request } from './transport'

export type DashboardSummary = {
  net_worth: string
  month: string
  income: string
  expenses: string
  expenses_by_category: CategoryExpense[]
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
  expenses: string
}

export type ExpenseTrend = {
  from_month: string
  to_month: string
  months: MonthBucket[]
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

export async function fetchExpenseTrend(
  token: string,
  fromMonth: string,
  toMonth: string,
): Promise<ExpenseTrend> {
  const response = await request(
    `/dashboard/expense-trend?from_month=${fromMonth}&to_month=${toMonth}`,
    {
      token,
      errorMessage: 'Could not load the expense trend',
    },
  )
  return (await response.json()) as ExpenseTrend
}
