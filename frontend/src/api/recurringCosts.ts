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
  /** The next Occurrence's own date, derived on the backend.
   * When frozen this is null (ADR-0028). */
  next_due_date: string | null
  /** The next Occurrence a new linked Expense would pay — the oldest Unpaid
   * one's own date (issue #57): what the transaction form's picker shows.
   * When frozen this is null (ADR-0028). */
  next_unpaid_occurrence_date: string | null
  /** The Backlog (issue #58): Unpaid Occurrences whose due date is today or
   * earlier in Europe/Rome — the "N unpaid" badge, derived on the backend
   * from the definition and the stored link pins, never stored. */
  backlog_count: number
  /** Whether the definition is frozen (ADR-0028). */
  frozen: boolean
  created_at: string
}

/** One row of the Occurrences section (ADR-0026): a non-Paid Occurrence —
 * its own date and whether the user excused it (Skipped, ADR-0016). Paid
 * history lives in the ledger and never appears. */
export type RecurringOccurrence = {
  date: string
  skipped: boolean
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

export async function fetchRecurringCosts(
  token: string,
  includeFrozen?: boolean,
): Promise<RecurringCost[]> {
  const url = includeFrozen
    ? '/recurring-costs?include_frozen=true'
    : '/recurring-costs'
  const response = await request(url, {
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

export async function freezeRecurringCost(
  token: string,
  costId: number,
): Promise<RecurringCost> {
  const response = await request(`/recurring-costs/${costId}/freeze`, {
    method: 'POST',
    token,
    errorMessage: 'Could not freeze recurring cost',
  })
  return (await response.json()) as RecurringCost
}

export async function unfreezeRecurringCost(
  token: string,
  costId: number,
): Promise<RecurringCost> {
  const response = await request(`/recurring-costs/${costId}/unfreeze`, {
    method: 'POST',
    token,
    errorMessage: 'Could not unfreeze recurring cost',
  })
  return (await response.json()) as RecurringCost
}

export async function fetchRecurringCostOccurrences(
  token: string,
  costId: number,
): Promise<RecurringOccurrence[]> {
  // The Occurrences section's read (ADR-0026): every non-Paid Occurrence
  // with its skipped state, newest first — the one order the edit modal
  // renders.
  const response = await request(`/recurring-costs/${costId}/occurrences`, {
    token,
    errorMessage: 'Could not load the occurrences',
  })
  return (await response.json()) as RecurringOccurrence[]
}

export async function setRecurringCostOccurrenceSkipped(
  token: string,
  costId: number,
  occurrenceDate: string,
  skipped: boolean,
): Promise<RecurringOccurrence[]> {
  // The per-Occurrence skip write (ADR-0026): state the row's skipped
  // state — skip or un-skip — idempotently. The response is the refreshed
  // read, so the modal swaps its rows in without a second fetch.
  const response = await request(`/recurring-costs/${costId}/occurrences/${occurrenceDate}`, {
    method: 'PUT',
    token,
    json: { skipped },
    errorMessage: 'Could not update the occurrence',
  })
  return (await response.json()) as RecurringOccurrence[]
}
