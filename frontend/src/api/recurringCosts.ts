/** Recurring Costs resource (issue #56): definitions of costs that repeat at
 * a fixed interval. Occurrences and `next_due_date` are derived on the
 * backend, never stored (ADR-0010). */

import { request } from './transport'

export type IntervalUnit = 'days' | 'weeks' | 'months' | 'years'

export type RecurringCost = {
  id: number
  name: string
  amount: string
  interval_value: number
  interval_unit: IntervalUnit
  /** The stored start date ("YYYY-MM-DD") — every definition always
   * carries one: left empty at creation it is set to the creation day
   * (ADR-0024), and an Occurrence's due date is its own date. */
  start_date: string
  /** The next Occurrence's own date, derived on the backend. */
  next_due_date: string
  /** The next Occurrence a new linked Expense would pay — the oldest Unpaid
   * one's own date (issue #57): what the transaction form's picker shows. */
  next_unpaid_occurrence_date: string
  /** The Backlog (issue #58): Unpaid Occurrences whose due date is today or
   * earlier in Europe/Rome — the "N unpaid" badge, derived on the backend
   * from the definition and the stored link pins, never stored. */
  backlog_count: number
  /** True exactly when the Backlog is non-empty — the Overdue mark. */
  overdue: boolean
  /** What the Skip/Un-skip button reads (ADR-0016): "skip" when the oldest
   * Unpaid Occurrence is unskipped, "unskip" when it is already Skipped. */
  next_skip_action: 'skip' | 'unskip'
  created_at: string
}

/** The fields the create/edit form edits. An empty start date is only ever
 * a creation-time convenience: the backend sets it to the creation day, and
 * afterwards the definition always carries one — the form treats the date
 * as required when editing (ADR-0024). The Wallet and Category of a linked
 * Expense are chosen at Transaction creation time — the definition itself
 * never carries them. */
export type RecurringCostInput = {
  name: string
  amount: string
  intervalValue: number
  intervalUnit: IntervalUnit
  startDate: string | null
}

function toPayload(input: RecurringCostInput) {
  return {
    name: input.name,
    amount: input.amount,
    interval_value: input.intervalValue,
    interval_unit: input.intervalUnit,
    start_date: input.startDate,
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

export async function toggleSkipRecurringCost(
  token: string,
  costId: number,
): Promise<RecurringCost> {
  // The Skip/Un-skip button (ADR-0016): the backend flips the oldest Unpaid
  // Occurrence (skip it, or un-skip it when everything is excused) and
  // returns the refreshed definition with its derived state.
  const response = await request(`/recurring-costs/${costId}/skip-toggle`, {
    method: 'POST',
    token,
    errorMessage: 'Could not update recurring cost',
  })
  return (await response.json()) as RecurringCost
}
