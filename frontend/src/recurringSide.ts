/** The Recurring screen's Costs | Incomes side, remembered for the app
 * session (issue #60): default Costs, and the last side the user looked at
 * survives the screen unmounting on a tab switch. A module-level value is
 * the right home for it — a fresh page load re-runs this module, which is
 * exactly when the memory resets ("reset on app load"). */

export type RecurringSide = 'costs' | 'incomes'

let side: RecurringSide = 'costs'

export function getRecurringSide(): RecurringSide {
  return side
}

export function setRecurringSide(next: RecurringSide): void {
  side = next
}
