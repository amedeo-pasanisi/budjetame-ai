/** Display helpers for Recurring definitions (issues #56, #60): the interval
 * text and the next-due ordering read the same on the Costs and the Incomes
 * sides (ADR-0011, ADR-0033). */

import type { IntervalUnit } from './api'

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

/** Definitions ordered by next due date ascending, ties by name — the one
 * order the Recurring screen renders (the backend list arrives sorted too;
 * this keeps locally upserted rows in place). The shape it needs is the two
 * fields the ordering reads. */
export function sortByNextDue<T extends { next_due_date: string | null; name: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const aDate = a.next_due_date ?? ''
    const bDate = b.next_due_date ?? ''
    return (
      aDate.localeCompare(bDate) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
  })
}
