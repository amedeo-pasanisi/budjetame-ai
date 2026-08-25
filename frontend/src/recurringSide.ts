/** The Recurring screen's Costs | Incomes side, remembered for the app
 * session (issue #60): default Costs, and the last side the user looked at
 * survives tab switches — keep-alive keeps the screen mounted, and the
 * module-level value still resets on app load, which is exactly when the
 * memory should reset. */

export type RecurringSide = 'costs' | 'incomes'

let side: RecurringSide = 'costs'

export function getRecurringSide(): RecurringSide {
  return side
}

export function setRecurringSide(next: RecurringSide): void {
  side = next
}
