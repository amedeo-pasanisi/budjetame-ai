import { useState } from 'react'

import type { LedgerFilterRequest } from './App'
import { RecurringCostsScreen } from './RecurringCostsScreen'
import { RecurringIncomesScreen } from './RecurringIncomesScreen'
import { getRecurringSide, setRecurringSide, type RecurringSide } from './recurringSide'

/** The Recurring tab (issue #60): a Costs | Incomes toggle above the two
 * sides. Default Costs; the last side is remembered for the app session —
 * the module-level value survives the screen unmounting on a tab switch and
 * resets on app load (recurringSide). The Costs side renders exactly as
 * before; the Incomes side mirrors it (ADR-0011). The ledger jump (issue
 * #90) rides through: the cards' main tap opens the Transactions tab
 * pre-filtered to the definition (ADR-0026). */
export function RecurringScreen({
  requestLedgerFilter,
}: {
  /** Send a ledger jump (issue #90): open the Transactions tab with the
   * ledger pre-filtered to one Recurring definition. Fired by the whole-row
   * tap surface (ADR-0026). Optional so tests can render the screen bare. */
  requestLedgerFilter?: (request: LedgerFilterRequest) => void
}) {
  const [side, setSide] = useState<RecurringSide>(getRecurringSide)

  const handleSelect = (next: RecurringSide) => {
    setRecurringSide(next)
    setSide(next)
  }

  return (
    <>
      <div className="flex gap-2" role="group" aria-label="Recurring side">
        <button
          type="button"
          onClick={() => handleSelect('costs')}
          aria-pressed={side === 'costs'}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
            side === 'costs'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Costs
        </button>
        <button
          type="button"
          onClick={() => handleSelect('incomes')}
          aria-pressed={side === 'incomes'}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
            side === 'incomes'
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          Incomes
        </button>
      </div>
      <div className="mt-4">
        {side === 'costs' ? (
          <RecurringCostsScreen requestLedgerFilter={requestLedgerFilter} />
        ) : (
          <RecurringIncomesScreen requestLedgerFilter={requestLedgerFilter} />
        )}
      </div>
    </>
  )
}
