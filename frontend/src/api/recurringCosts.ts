/** The Recurring Costs side of the Recurring definition calls (issue #56):
 * the shared calls bound to `/recurring-costs`, exported under the names
 * the rest of the app imports (ADR-0033). */

import {
  recurringDefinitionApi,
  type RecurringDefinition,
  type RecurringDefinitionInput,
} from './recurringDefinitions'

export type RecurringCost = RecurringDefinition
export type RecurringCostInput = RecurringDefinitionInput

const api = recurringDefinitionApi('recurring-costs', 'recurring cost')

export const fetchRecurringCosts = api.fetchAll
export const createRecurringCost = api.create
export const updateRecurringCost = api.update
export const freezeRecurringCost = api.freeze
export const unfreezeRecurringCost = api.unfreeze
export const fetchRecurringCostOccurrences = api.fetchOccurrences
export const setRecurringCostOccurrenceSkipped = api.setOccurrenceSkipped
