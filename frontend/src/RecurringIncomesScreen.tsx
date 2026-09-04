import { useEffect, useState } from 'react'

import {
  TOKEN_KEY,
  fetchRecurringIncomes,
  formatEuros,
  toggleSkipRecurringIncome,
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
 * live here, in a modal. The badge is derived state from the API: it
 * refreshes whenever the list reloads (tab switch after a link change) or a
 * saved definition comes back from the modal. */
export function RecurringIncomesScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [incomes, setIncomes] = useState<RecurringIncome[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  // The income whose Skip/Un-skip button is in flight — the button disables
  // itself so a double tap cannot flip the state twice (skip then un-skip).
  const [togglingId, setTogglingId] = useState<number | null>(null)
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

  // The Skip/Un-skip button (ADR-0016), mirroring the Costs side: the
  // backend flips the oldest Unpaid Occurrence and returns the refreshed
  // definition — the card swaps it in, so the badge and the next due date
  // re-render from the response.
  const handleToggleSkip = (income: RecurringIncome) => {
    setTogglingId(income.id)
    toggleSkipRecurringIncome(token, income.id)
      .then((toggled) => {
        setIncomes((current) =>
          current === null
            ? [toggled]
            : sortByNextDue(
                current.map((existing) =>
                  existing.id === toggled.id ? toggled : existing,
                ),
              ),
        )
      })
      .catch(() => setLoadError('Could not update your recurring incomes.'))
      .finally(() => setTogglingId(null))
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
            <li key={income.id} className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => setModal({ kind: 'edit', income })}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
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
                onClick={() => handleToggleSkip(income)}
                disabled={togglingId === income.id}
                className="shrink-0 self-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
              >
                {income.next_skip_action === 'unskip' ? 'Un-skip' : 'Skip'}
              </button>
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
