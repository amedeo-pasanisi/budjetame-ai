/** Recurring Costs resource (issue #56): definitions of costs that repeat at
 * a fixed interval. Occurrences and `next_due_date` are derived on the
 * backend, never stored (ADR-0010). */

import { request } from './transport'

export type IntervalUnit = 'days' | 'weeks' | 'months' | 'years'

export type RecurringCost = {
  id: number
  name: string
  amount: string
  wallet_id: number
  category_id: number | null
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
  /** The next Occurrence a new linked Expense would pay — the oldest Unpaid
   * one's own date (issue #57): what the transaction form's picker shows. */
  next_unpaid_occurrence_date: string
  created_at: string
}

/** The fields the create/edit form edits. Null means "unset": an unset start
 * date defaults to the creation date; the due-date override is dropped when
 * the unit or an incomplete pair doesn't carry it. */
export type RecurringCostInput = {
  name: string
  amount: string
  walletId: number
  categoryId: number | null
  intervalValue: number
  intervalUnit: IntervalUnit
  startDate: string | null
  dueDay: number | null
  dueMonth: number | null
}

function toPayload(input: RecurringCostInput) {
  return {
    name: input.name,
    amount: input.amount,
    wallet_id: input.walletId,
    category_id: input.categoryId,
    interval_value: input.intervalValue,
    interval_unit: input.intervalUnit,
    start_date: input.startDate,
    due_day: input.dueDay,
    due_month: input.dueMonth,
  }
}

export async function fetchRecurringCosts(token: string): Promise<RecurringCost[]> {
  const response = await request('/recurring-costs', {
    token,
    errorMessage: 'Could not load recurring costs',
  })
  return (await response.json()) as RecurringCost[]
}

export async function createRecurringCost(
  token: string,
  input: RecurringCostInput,
): Promise<RecurringCost> {
  const response = await request('/recurring-costs', {
    method: 'POST',
    token,
    json: toPayload(input),
    errorMessage: 'Could not create recurring cost',
  })
  return (await response.json()) as RecurringCost
}

export async function updateRecurringCost(
  token: string,
  costId: number,
  input: RecurringCostInput,
): Promise<RecurringCost> {
  // The whole editable definition is sent (like the Category form): the
  // backend applies every present field, nulls clear the optional ones.
  const response = await request(`/recurring-costs/${costId}`, {
    method: 'PATCH',
    token,
    json: toPayload(input),
    errorMessage: 'Could not update recurring cost',
  })
  return (await response.json()) as RecurringCost
}

export async function deleteRecurringCost(token: string, costId: number): Promise<void> {
  await request(`/recurring-costs/${costId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not delete recurring cost',
  })
}
