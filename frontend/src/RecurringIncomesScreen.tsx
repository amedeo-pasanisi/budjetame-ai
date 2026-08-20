import { useEffect, useState } from 'react'

import {
  TOKEN_KEY,
  fetchCategories,
  fetchRecurringIncomes,
  fetchWallets,
  formatEuros,
  type Category,
  type RecurringIncome,
  type Wallet,
} from './api'
import { RecurringIncomeModal } from './RecurringIncomeModal'
import { intervalText, sortByNextDue } from './recurringIncomes'

/** The modal's draft: create (no income) or edit (an income). Null means the
 * modal is closed — one modal serves both, like the Wallets and Categories
 * tabs (issue #49). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; income: RecurringIncome }

/** The Recurring tab's Incomes side (issue #60): every Recurring Income
 * sorted by next due date — the screen's one order — each row showing name,
 * amount, interval, and the next due date (derived on the backend, override
 * applied, clamping included), plus the Backlog badge ("N unpaid", issue
 * #62) and the Overdue mark. The summary line on top — "X incomes overdue ·
 * N unpaid occurrences" — answers the original question at a glance: what
 * remains to receive. The screen mirrors the Costs side (issue #56,
 * ADR-0011). Create, edit, and delete live here, in a modal; Wallets and
 * Categories are fetched too, so the form's selectors are ready the moment
 * it opens. The badge, the mark, and the summary are all derived state from
 * the API: they refresh whenever the list reloads (tab switch after a link
 * change) or a saved definition comes back from the modal. */
export function RecurringIncomesScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [incomes, setIncomes] = useState<RecurringIncome[] | null>(null)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)

  useEffect(() => {
    let cancelled = false
    // The list and the form's selectors load together; any failure is one
    // load error. The form can still open — it just shows fewer choices
    // (or a disabled save with no wallets) until a reload.
    Promise.all([
      fetchRecurringIncomes(token),
      fetchWallets(token, true),
      fetchCategories(token),
    ])
      .then(([loadedIncomes, loadedWallets, loadedCategories]) => {
        if (cancelled) return
        setIncomes(sortByNextDue(loadedIncomes))
        setWallets(loadedWallets)
        setCategories(loadedCategories)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your recurring incomes.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

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
    setModal(null)
  }

  const handleDeleted = (incomeId: number) => {
    setIncomes((current) =>
      current === null ? current : current.filter((income) => income.id !== incomeId),
    )
    setModal(null)
  }

  // The summary line (issue #62): totals over the loaded incomes. Only shown
  // when there is at least one income — the empty state already answers
  // "what remains to receive" for a screen with nothing on it.
  const overdueCount =
    incomes === null ? 0 : incomes.filter((income) => income.overdue).length
  const unpaidCount =
    incomes === null ? 0 : incomes.reduce((sum, income) => sum + income.backlog_count, 0)

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

      {incomes !== null && incomes.length > 0 && (
        <p className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          {overdueCount} {overdueCount === 1 ? 'income overdue' : 'incomes overdue'} ·{' '}
          {unpaidCount}{' '}
          {unpaidCount === 1 ? 'unpaid occurrence' : 'unpaid occurrences'}
        </p>
      )}

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
              <button
                type="button"
                onClick={() => setModal({ kind: 'edit', income })}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">
                    {income.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {intervalText(income.interval_value, income.interval_unit)} · next
                    due {income.next_due_date}
                  </span>
                  {income.overdue && (
                    <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      Overdue
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold text-slate-900">
                    {formatEuros(income.amount)}
                  </span>
                  {income.backlog_count > 0 && (
                    <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      {income.backlog_count} unpaid
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {modal !== null && (
        <RecurringIncomeModal
          income={modal.kind === 'edit' ? modal.income : undefined}
          wallets={wallets}
          categories={categories}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
