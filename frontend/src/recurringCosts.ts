/** Display helpers for Recurring Costs (issue #56). */

import type { IntervalUnit, RecurringCost } from './api'

const UNIT_LABELS: Record<IntervalUnit, [string, string]> = {
  days: ['day', 'days'],
  weeks: ['week', 'weeks'],
  months: ['month', 'months'],
  years: ['year', 'years'],
}

/** The interval as display text: "Every month", "Every 2 weeks", "Every
 * 5 days", "Every year" — singular for 1, plural otherwise. */
export function intervalText(value: number, unit: IntervalUnit): string {
  const [one, many] = UNIT_LABELS[unit]
  return value === 1 ? `Every ${one}` : `Every ${value} ${many}`
}

/** Costs ordered by next due date ascending, ties by name — the one order
 * the Recurring screen renders (the backend list arrives sorted too; this
 * keeps locally upserted rows in place). */
export function sortByNextDue(costs: RecurringCost[]): RecurringCost[] {
  return [...costs].sort(
    (a, b) =>
      a.next_due_date.localeCompare(b.next_due_date) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}
