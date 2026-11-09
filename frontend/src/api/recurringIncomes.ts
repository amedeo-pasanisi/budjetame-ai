/** The Recurring Incomes side of the Recurring definition calls (issue #60):
 * the shared calls bound to `/recurring-incomes`, exported under the names
 * the rest of the app imports (ADR-0011, ADR-0033). */

import {
  recurringDefinitionApi,
  type RecurringDefinition,
  type RecurringDefinitionInput,
} from './recurringDefinitions'

export type RecurringIncome = RecurringDefinition
export type RecurringIncomeInput = RecurringDefinitionInput

const api = recurringDefinitionApi('recurring-incomes', 'recurring income')

export const fetchRecurringIncomes = api.fetchAll
export const createRecurringIncome = api.create
export const updateRecurringIncome = api.update
export const freezeRecurringIncome = api.freeze
export const unfreezeRecurringIncome = api.unfreeze
export const fetchRecurringIncomeOccurrences = api.fetchOccurrences
export const setRecurringIncomeOccurrenceSkipped = api.setOccurrenceSkipped
