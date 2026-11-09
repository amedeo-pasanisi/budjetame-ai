/** The two sides of the Recurring tab (issue #60, ADR-0011) as the one
 * table the shared Recurring definition modules read (ADR-0033): the
 * Costs | Incomes toggle picks a side, and everything that differs between
 * the sides — the API calls, the i18n catalog prefixes, the Ledger jump
 * kind, the form's element ids — comes from here. The form, screen and
 * modal are written once against this table.
 *
 * The side itself is remembered for the app session: default Costs, and
 * the last side the user looked at survives tab switches — keep-alive keeps
 * the screen mounted, and the module-level value still resets on app load,
 * which is exactly when the memory should reset. */

import {
  createRecurringCost,
  createRecurringIncome,
  fetchRecurringCostOccurrences,
  fetchRecurringCosts,
  fetchRecurringIncomeOccurrences,
  fetchRecurringIncomes,
  freezeRecurringCost,
  freezeRecurringIncome,
  setRecurringCostOccurrenceSkipped,
  setRecurringIncomeOccurrenceSkipped,
  unfreezeRecurringCost,
  unfreezeRecurringIncome,
  updateRecurringCost,
  updateRecurringIncome,
  type RecurringDefinitionApi,
} from './api'

export type RecurringSide = 'costs' | 'incomes'

export type SideAdapter = {
  api: RecurringDefinitionApi
  /** The catalog prefixes of the side's strings: the two sides keep their
   * own wording ("what remains to pay" / "to receive"), so the shared
   * modules build every message id as `${prefix}.${key}`. */
  messages: { screen: string; form: string; modal: string }
  /** The Ledger jump kind a row's main tap sends (issue #90, ADR-0026). */
  jumpKind: 'recurring-cost' | 'recurring-income'
  /** The prefix of the form's element ids ("recurring-cost-name"). */
  idPrefix: string
}

/** The side table. The api calls go through the barrel — the seam the
 * tests mock — and are resolved at call time, not at module load: a test
 * that mocks only one side's calls never touches the other side's. */
export const SIDES: Record<RecurringSide, SideAdapter> = {
  costs: {
    api: {
      fetchAll: (token, includeFrozen) => fetchRecurringCosts(token, includeFrozen),
      create: (token, input) => createRecurringCost(token, input),
      update: (token, id, input) => updateRecurringCost(token, id, input),
      freeze: (token, id) => freezeRecurringCost(token, id),
      unfreeze: (token, id) => unfreezeRecurringCost(token, id),
      fetchOccurrences: (token, id) => fetchRecurringCostOccurrences(token, id),
      setOccurrenceSkipped: (token, id, date, skipped) =>
        setRecurringCostOccurrenceSkipped(token, id, date, skipped),
    },
    messages: {
      screen: 'recurringCosts',
      form: 'recurringCostForm',
      modal: 'recurringCostModal',
    },
    jumpKind: 'recurring-cost',
    idPrefix: 'recurring-cost',
  },
  incomes: {
    api: {
      fetchAll: (token, includeFrozen) => fetchRecurringIncomes(token, includeFrozen),
      create: (token, input) => createRecurringIncome(token, input),
      update: (token, id, input) => updateRecurringIncome(token, id, input),
      freeze: (token, id) => freezeRecurringIncome(token, id),
      unfreeze: (token, id) => unfreezeRecurringIncome(token, id),
      fetchOccurrences: (token, id) => fetchRecurringIncomeOccurrences(token, id),
      setOccurrenceSkipped: (token, id, date, skipped) =>
        setRecurringIncomeOccurrenceSkipped(token, id, date, skipped),
    },
    messages: {
      screen: 'recurringIncomes',
      form: 'recurringIncomeForm',
      modal: 'recurringIncomeModal',
    },
    jumpKind: 'recurring-income',
    idPrefix: 'recurring-income',
  },
}

let side: RecurringSide = 'costs'

export function getRecurringSide(): RecurringSide {
  return side
}

export function setRecurringSide(next: RecurringSide): void {
  side = next
}
