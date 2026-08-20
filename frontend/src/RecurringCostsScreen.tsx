import { useEffect, useState } from 'react'

import {
  TOKEN_KEY,
  fetchCategories,
  fetchRecurringCosts,
  fetchWallets,
  formatEuros,
  type Category,
  type RecurringCost,
  type Wallet,
} from './api'
import { CategoryModal } from './CategoryModal'
import { RecurringCostModal } from './RecurringCostModal'
import { intervalText, sortByNextDue } from './recurringCosts'

/** The modal's draft: create (no cost) or edit (a cost). Null means the
 * modal is closed — one modal serves both, like the Wallets and Categories
 * tabs (issue #49). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; cost: RecurringCost }

/** The Recurring tab (issue #56): every Recurring Cost sorted by next due
 * date — the screen's one order — each row showing name, amount, interval,
 * and the next due date (derived on the backend, override applied), plus
 * the Backlog badge ("N unpaid", issue #58) and the Overdue mark. The
 * summary line on top — "X costs overdue · N unpaid occurrences" — answers
 * the original question at a glance. Create, edit, and delete live here, in
 * a modal; Wallets and Categories are fetched too, so the form's selectors
 * are ready the moment it opens. The badge, the mark, and the summary are
 * all derived state from the API: they refresh whenever the list reloads
 * (tab switch after a link change) or a saved definition comes back from
 * the modal. */
export function RecurringCostsScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [costs, setCosts] = useState<RecurringCost[] | null>(null)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  // Inline entity creation (ADR-0013): the inner Category create modal,
  // stacked on top of the form's modal, and the new Category it created —
  // reported back to the open form so its field selects it.
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryToSelect, setCategoryToSelect] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // The list and the form's selectors load together; any failure is one
    // load error. The form can still open — it just shows fewer choices
    // (or a disabled save with no wallets) until a reload.
    Promise.all([
      fetchRecurringCosts(token),
      fetchWallets(token, true),
      fetchCategories(token),
    ])
      .then(([loadedCosts, loadedWallets, loadedCategories]) => {
        if (cancelled) return
        setCosts(sortByNextDue(loadedCosts))
        setWallets(loadedWallets)
        setCategories(loadedCategories)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your recurring costs.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // The inner Category modal's save (ADR-0013): add the Category to the
  // list state (so the dropdown offers it again without a reload), close
  // only the inner modal, and report the new id to the open form so the
  // originating field selects it. The form's draft is untouched.
  const handleCategoryCreated = (category: Category) => {
    setCategories((current) => (current === null ? [category] : [...current, category]))
    setCategoryToSelect(category.id)
    setCategoryModalOpen(false)
  }

  // Closing the outer modal also clears the pending auto-select: a stale id
  // must not be re-applied when the form opens again later.
  const closeModal = () => {
    setModal(null)
    setCategoryToSelect(null)
  }

  const handleSaved = (cost: RecurringCost) => {
    setCosts((current) => {
      if (current === null) {
        return [cost]
      }
      return sortByNextDue(
        current.some((existing) => existing.id === cost.id)
          ? current.map((existing) => (existing.id === cost.id ? cost : existing))
          : [...current, cost],
      )
    })
    closeModal()
  }

  const handleDeleted = (costId: number) => {
    setCosts((current) =>
      current === null ? current : current.filter((cost) => cost.id !== costId),
    )
    closeModal()
  }

  // The summary line (issue #58): totals over the loaded costs. Only shown
  // when there is at least one cost — the empty state already answers
  // "what remains to pay" for a screen with nothing on it.
  const overdueCount =
    costs === null ? 0 : costs.filter((cost) => cost.overdue).length
  const unpaidCount =
    costs === null ? 0 : costs.reduce((sum, cost) => sum + cost.backlog_count, 0)

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Recurring Costs</h2>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          New recurring cost
        </button>
      </div>

      {loadError !== null && <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>}

      {costs !== null && costs.length > 0 && (
        <p className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          {overdueCount} {overdueCount === 1 ? 'cost overdue' : 'costs overdue'} ·{' '}
          {unpaidCount}{' '}
          {unpaidCount === 1 ? 'unpaid occurrence' : 'unpaid occurrences'}
        </p>
      )}

      {costs === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading recurring costs…</p>
      ) : costs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No recurring costs yet. Add your first one to track what&apos;s due.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {costs.map((cost) => (
            <li key={cost.id}>
              <button
                type="button"
                onClick={() => setModal({ kind: 'edit', cost })}
                className="flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">
                    {cost.name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {intervalText(cost.interval_value, cost.interval_unit)} · next
                    due {cost.next_due_date}
                  </span>
                  {cost.overdue && (
                    <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      Overdue
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold text-slate-900">
                    {formatEuros(cost.amount)}
                  </span>
                  {cost.backlog_count > 0 && (
                    <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      {cost.backlog_count} unpaid
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {modal !== null && (
        <RecurringCostModal
          cost={modal.kind === 'edit' ? modal.cost : undefined}
          wallets={wallets}
          categories={categories}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={closeModal}
          onAddCategory={() => setCategoryModalOpen(true)}
          categoryToSelect={categoryToSelect}
        />
      )}

      {categoryModalOpen && (
        <CategoryModal
          lockedType="expense"
          onSaved={handleCategoryCreated}
          onClose={() => setCategoryModalOpen(false)}
        />
      )}
    </>
  )
}
