import { useEffect, useState } from 'react'

import type { LedgerFilterRequest } from './App'
import {
  TOKEN_KEY,
  fetchRecurringIncomes,
  formatEuros,
  type RecurringIncome,
} from './api'
import { useDataVersion } from './api/dataVersion'
import { RecurringIncomeModal } from './RecurringIncomeModal'
import { intervalText, sortByNextDue } from './recurringIncomes'

/** The modal's draft: create (no income) or edit (an income). Null means the
 * modal is closed — one modal serves both, like the Wallets and Categories
 * tabs (issue #49). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; income: RecurringIncome }

/** The Recurring tab's Incomes side (issue #60): every Recurring Income
 * sorted by next due date — the screen's one order — each row showing name,
 * amount, interval, the next due date (derived on the backend), and the
 * Backlog badge (issue #62): the red "N unpaid" badge that answers the
 * original question — what remains to receive (ADR-0025). The screen
 * mirrors the Costs side (issue #56, ADR-0011). Create, edit, and delete
 * live here, in a modal.
 *
 * Row structure (ADR-0026): like the Wallets rows (issue #93), a row is a
 * main tap surface with a sibling trailing ✎ button inside one card —
 * nested buttons are illegal. The tap surface (name, amount, next due,
 * badge) sends the ledger jump (issue #90): the shell opens the
 * Transactions tab pre-filtered to this definition's linked Transactions.
 * The ✎ button opens the edit modal — whose Occurrences section carries
 * the per-Occurrence Skip/Un-skip controls: the card Skip/Un-skip button
 * is gone, and the badge stays the only Backlog signal. The badge is
 * derived state from the API: it refreshes whenever the list reloads (tab
 * switch after a link change) or a saved definition comes back from the
 * modal. */
export function RecurringIncomesScreen({
  requestLedgerFilter,
}: {
  /** Send a ledger jump (issue #90): open the Transactions tab with the
   * ledger pre-filtered to one Recurring Income. Fired by the whole-row tap
   * surface (ADR-0026). Optional so tests can render the screen bare. */
  requestLedgerFilter?: (request: LedgerFilterRequest) => void
}) {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [incomes, setIncomes] = useState<RecurringIncome[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  // The cache clock (ADR-0022): a write anywhere re-fetches this list in
  // the background, so the tab is never stale when switched back to.
  const dataVersion = useDataVersion()

  useEffect(() => {
    let cancelled = false
    fetchRecurringIncomes(token)
      .then((loadedIncomes) => {
        if (cancelled) return
        setIncomes(sortByNextDue(loadedIncomes))
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your recurring incomes.')
      })
    return () => {
      cancelled = true
    }
  }, [token, dataVersion])

  const closeModal = () => {
    setModal(null)
  }

  const handleSaved = (income: RecurringIncome) => {
    setIncomes((current) => {
      if (current === null) {
        return [income]
      }
      return sortByNextDue(
        current.some((existing) => existing.id === income.id)
          ? current.map((existing) => (existing.id === income.id ? income : existing))
          : [...current, income],
      )
    })
    closeModal()
  }

  const handleDeleted = (incomeId: number) => {
    setIncomes((current) =>
      current === null ? current : current.filter((income) => income.id !== incomeId),
    )
    closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Recurring Incomes</h2>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          New recurring income
        </button>
      </div>

      {loadError !== null && <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>}

      {incomes === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading recurring incomes…</p>
      ) : incomes.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No recurring incomes yet. Add your first one to track what&apos;s due.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {incomes.map((income) => (
            <li key={income.id}>
              {/* A row is a tap surface plus a sibling trailing ✎ (ADR-0026):
                  the card holds the surface and the ✎ side by side — nested
                  buttons are illegal. The whole surface (name, amount, next
                  due, badge) is the ledger jump to this definition's linked
                  Transactions; ✎ opens the edit modal, where the
                  per-Occurrence Skip/Un-skip controls live. */}
              <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() =>
                    requestLedgerFilter?.({ kind: 'recurring-income', id: income.id })
                  }
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 pr-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">
                      {income.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {intervalText(income.interval_value, income.interval_unit)} · next
                      due {income.next_due_date}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold text-slate-900">
                      {formatEuros(income.amount)}
                    </span>
                    {income.backlog_count > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                        {income.backlog_count} unpaid
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${income.name}`}
                  onClick={() => setModal({ kind: 'edit', income })}
                  className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
                >
                  ✎
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal !== null && (
        <RecurringIncomeModal
          income={modal.kind === 'edit' ? modal.income : undefined}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={closeModal}
        />
      )}
    </>
  )
}
