/** Display helpers for Recurring Incomes (issue #60). The interval text and
 * the next-due ordering are the same reads as the Costs side (issue #56), so
 * the helpers are shared, not duplicated (ADR-0011 leaves the display layer
 * free to reuse them). */

export { intervalText, sortByNextDue } from './recurringCosts'
