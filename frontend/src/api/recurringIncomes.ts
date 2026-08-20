/** Recurring Incomes resource (issue #60): definitions of incomes that
 * repeat at a fixed interval, mirroring Recurring Costs (ADR-0011).
 * Occurrences, `next_due_date`, and the Backlog are derived on the backend,
 * never stored (ADR-0010). */

import { request } from './transport'

export type IntervalUnit = 'days' | 'weeks' | 'months' | 'years'

export type RecurringIncome = {
  id: number
  name: string
  amount: string
  interval_value: number
  interval_unit: IntervalUnit
  /** The stored start date ("YYYY-MM-DD"); null when unset — the creation
   * date is used instead (backend derivation). */
  start_date: string | null
  due_day: number | null
  due_month: number | null
  /** The next Occurrence's due date, derived on the backend (override
   * applied, clamping included). */
  next_due_date: string
  /** The next Occurrence a new linked Income would receive — the oldest
   * Unpaid one's own date (issue #61): what the transaction form's picker
   * shows. */
  next_unpaid_occurrence_date: string
  /** The Backlog (issue #62): Unpaid Occurrences whose due date is today or
   * earlier in Europe/Rome — the "N unpaid" badge, derived on the backend
   * from the definition and the stored link pins, never stored. */
  backlog_count: number
  /** True exactly when the Backlog is non-empty — the Overdue mark. */
  overdue: boolean
  created_at: string
}

/** The fields the create/edit form edits. Null means "unset": an unset start
 * date defaults to the creation date; the due-date override is dropped when
 * the unit or an incomplete pair doesn't carry it. The Wallet and Category
 * of a linked Income are chosen at Transaction creation time — the
 * definition itself never carries them. */
export type RecurringIncomeInput = {
  name: string
  amount: string
  intervalValue: number
  intervalUnit: IntervalUnit
  startDate: string | null
  dueDay: number | null
  dueMonth: number | null
}

function toPayload(input: RecurringIncomeInput) {
  return {
    name: input.name,
    amount: input.amount,
    interval_value: input.intervalValue,
    interval_unit: input.intervalUnit,
    start_date: input.startDate,
    due_day: input.dueDay,
    due_month: input.dueMonth,
  }
}

export async function fetchRecurringIncomes(token: string): Promise<RecurringIncome[]> {
  const response = await request('/recurring-incomes', {
    token,
    errorMessage: 'Could not load recurring incomes',
  })
  return (await response.json()) as RecurringIncome[]
}

export async function createRecurringIncome(
  token: string,
  input: RecurringIncomeInput,
): Promise<RecurringIncome> {
  const response = await request('/recurring-incomes', {
    method: 'POST',
    token,
    json: toPayload(input),
    errorMessage: 'Could not create recurring income',
  })
  return (await response.json()) as RecurringIncome
}

export async function updateRecurringIncome(
  token: string,
  incomeId: number,
  input: RecurringIncomeInput,
): Promise<RecurringIncome> {
  // The whole editable definition is sent (like the Category form): the
  // backend applies every present field, nulls clear the optional ones.
  const response = await request(`/recurring-incomes/${incomeId}`, {
    method: 'PATCH',
    token,
    json: toPayload(input),
    errorMessage: 'Could not update recurring income',
  })
  return (await response.json()) as RecurringIncome
}

export async function deleteRecurringIncome(token: string, incomeId: number): Promise<void> {
  await request(`/recurring-incomes/${incomeId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not delete recurring income',
  })
}
