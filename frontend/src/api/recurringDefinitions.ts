/** Recurring definitions (issues #56, #60): Recurring Costs and Recurring
 * Incomes are two resources with one wire shape and one set of calls
 * (ADR-0011, ADR-0033). `recurringDefinitionApi` binds the calls to one
 * resource path; `./recurringCosts` and `./recurringIncomes` export the
 * two bound sides under their own names. Occurrences, `next_due_date` and
 * the Backlog are derived on the backend, never stored (ADR-0010). */

import { request } from './transport'

export type IntervalUnit = 'days' | 'weeks' | 'months' | 'years'

/** A Recurring Cost or a Recurring Income as the API serves it. */
export type RecurringDefinition = {
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
  /** The next Occurrence a new linked Transaction would pay — the oldest
   * Unpaid one's own date (issues #57, #61): what the transaction form's
   * picker shows. When frozen this is null (ADR-0028). */
  next_unpaid_occurrence_date: string | null
  /** The Backlog (issues #58, #62): Unpaid Occurrences whose due date is
   * today or earlier in Europe/Rome — the "N unpaid" badge, derived on the
   * backend from the definition and the stored link pins, never stored. */
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
 * Transaction are chosen at Transaction creation time — the definition
 * itself never carries them. */
export type RecurringDefinitionInput = {
  name: string
  amount: string
  intervalValue: number
  intervalUnit: IntervalUnit
  startDate: string | null
}

/** The calls one side of the Recurring tab makes: the list, the lifecycle
 * (create, update, freeze, unfreeze) and the Occurrences section's read
 * and skip write (ADR-0026). */
export type RecurringDefinitionApi = {
  fetchAll(token: string, includeFrozen?: boolean): Promise<RecurringDefinition[]>
  create(token: string, input: RecurringDefinitionInput): Promise<RecurringDefinition>
  update(
    token: string,
    id: number,
    input: RecurringDefinitionInput,
  ): Promise<RecurringDefinition>
  freeze(token: string, id: number): Promise<RecurringDefinition>
  unfreeze(token: string, id: number): Promise<RecurringDefinition>
  fetchOccurrences(token: string, id: number): Promise<RecurringOccurrence[]>
  setOccurrenceSkipped(
    token: string,
    id: number,
    occurrenceDate: string,
    skipped: boolean,
  ): Promise<RecurringOccurrence[]>
}

function toPayload(input: RecurringDefinitionInput) {
  return {
    name: input.name,
    amount: input.amount,
    interval_value: input.intervalValue,
    interval_unit: input.intervalUnit,
    start_date: input.startDate,
  }
}

/** The calls bound to one resource: `resource` is the URL segment
 * ("recurring-costs"), `noun` the words the error messages use
 * ("recurring cost"). */
export function recurringDefinitionApi(
  resource: 'recurring-costs' | 'recurring-incomes',
  noun: 'recurring cost' | 'recurring income',
): RecurringDefinitionApi {
  const base = `/${resource}`
  return {
    async fetchAll(token, includeFrozen) {
      const url = includeFrozen ? `${base}?include_frozen=true` : base
      const response = await request(url, {
        token,
        errorMessage: `Could not load ${noun}s`,
      })
      return (await response.json()) as RecurringDefinition[]
    },

    async create(token, input) {
      const response = await request(base, {
        method: 'POST',
        token,
        json: toPayload(input),
        errorMessage: `Could not create ${noun}`,
      })
      return (await response.json()) as RecurringDefinition
    },

    async update(token, id, input) {
      // The whole editable definition is sent (like the Category form): the
      // backend applies every present field, nulls clear the optional ones.
      const response = await request(`${base}/${id}`, {
        method: 'PATCH',
        token,
        json: toPayload(input),
        errorMessage: `Could not update ${noun}`,
      })
      return (await response.json()) as RecurringDefinition
    },

    async freeze(token, id) {
      const response = await request(`${base}/${id}/freeze`, {
        method: 'POST',
        token,
        errorMessage: `Could not freeze ${noun}`,
      })
      return (await response.json()) as RecurringDefinition
    },

    async unfreeze(token, id) {
      const response = await request(`${base}/${id}/unfreeze`, {
        method: 'POST',
        token,
        errorMessage: `Could not unfreeze ${noun}`,
      })
      return (await response.json()) as RecurringDefinition
    },

    async fetchOccurrences(token, id) {
      // The Occurrences section's read (ADR-0026): every non-Paid
      // Occurrence with its skipped state, newest first — the one order the
      // edit modal renders.
      const response = await request(`${base}/${id}/occurrences`, {
        token,
        errorMessage: 'Could not load the occurrences',
      })
      return (await response.json()) as RecurringOccurrence[]
    },

    async setOccurrenceSkipped(token, id, occurrenceDate, skipped) {
      // The per-Occurrence skip write (ADR-0026): state the row's skipped
      // state — skip or un-skip — idempotently. The response is the
      // refreshed read, so the modal swaps its rows in without a second
      // fetch.
      const response = await request(`${base}/${id}/occurrences/${occurrenceDate}`, {
        method: 'PUT',
        token,
        json: { skipped },
        errorMessage: 'Could not update the occurrence',
      })
      return (await response.json()) as RecurringOccurrence[]
    },
  }
}
