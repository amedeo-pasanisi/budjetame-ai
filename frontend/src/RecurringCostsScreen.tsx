import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'

import type { LedgerFilterRequest } from './App'
import {
  TOKEN_KEY,
  fetchRecurringCosts,
  formatEuros,
  type RecurringCost,
} from './api'
import { useDataVersion } from './api/dataVersion'
import { RecurringCostModal } from './RecurringCostModal'
import { intervalText, sortByNextDue } from './recurringCosts'

/** The modal's draft: create (no cost) or edit (a cost). Null means the
 * modal is closed — one modal serves both, like the Wallets and Categories
 * tabs (issue #49). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; cost: RecurringCost }

/** The Recurring tab's Costs side (issue #56): every Recurring Cost sorted
 * by next due date — the screen's one order — each row showing name,
 * amount, interval, the next due date (derived on the backend), and the
 * Backlog badge (issue #58): the red "N unpaid" badge that answers the
 * original question — what remains to pay (ADR-0025). Create, edit, and
 * delete live in a modal.
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
export function RecurringCostsScreen({
  requestLedgerFilter,
}: {
  /** Send a ledger jump (issue #90): open the Transactions tab with the
   * ledger pre-filtered to one Recurring Cost. Fired by the whole-row tap
   * surface (ADR-0026). Optional so tests can render the screen bare. */
  requestLedgerFilter?: (request: LedgerFilterRequest) => void
}) {
  const { formatMessage } = useIntl()
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [costs, setCosts] = useState<RecurringCost[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  const [frozenExpanded, setFrozenExpanded] = useState(false)
  // The cache clock (ADR-0022): a write anywhere re-fetches this list in
  // the background, so the tab is never stale when switched back to.
  const dataVersion = useDataVersion()

  // Active and frozen definitions, split from the fetched set
  // (include_frozen=true on the fetch for the collapsed Frozen Recurring
  // section, ADR-0028).
  const activeCosts = useMemo(
    () => costs?.filter((c) => !c.frozen) ?? null,
    [costs],
  )
  const frozenCosts = useMemo(
    () => costs?.filter((c) => c.frozen) ?? null,
    [costs],
  )

  useEffect(() => {
    let cancelled = false
    fetchRecurringCosts(token, true)
      .then((loadedCosts) => {
        if (cancelled) return
        setCosts(sortByNextDue(loadedCosts))
      })
      .catch(() => {
        if (!cancelled) setLoadError(formatMessage({ id: 'recurringCosts.loadError' }))
      })
    return () => {
      cancelled = true
    }
  }, [token, dataVersion, formatMessage])

  const closeModal = () => {
    setModal(null)
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

  const handleFreeze = (cost: RecurringCost) => {
    setCosts((current) =>
      current === null
        ? current
        : sortByNextDue(
            current.map((existing) =>
              existing.id === cost.id ? cost : existing,
            ),
          ),
    )
    closeModal()
  }

  const handleUnfreeze = (cost: RecurringCost) => {
    setCosts((current) =>
      current === null
        ? current
        : sortByNextDue(
            current.map((existing) =>
              existing.id === cost.id ? cost : existing,
            ),
          ),
    )
    closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">{formatMessage({ id: 'recurringCosts.title' })}</h2>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {formatMessage({ id: 'recurringCosts.new' })}
        </button>
      </div>

      {loadError !== null && <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>}

      {costs === null ? (
        <p className="mt-3 text-sm text-slate-500">{formatMessage({ id: 'recurringCosts.loading' })}</p>
      ) : activeCosts !== null && activeCosts.length === 0 && frozenCosts?.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          {formatMessage({ id: 'recurringCosts.empty' })}
        </p>
      ) : (
        <>
          {activeCosts !== null && activeCosts.length > 0 && (
            <ul className="mt-4 space-y-2">
              {activeCosts.map((cost) => (
                <li key={cost.id}>
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() =>
                        requestLedgerFilter?.({ kind: 'recurring-cost', id: cost.id })
                      }
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 pr-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">
                          {cost.name}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {formatMessage({ id: 'recurringCosts.nextDue' }, {
                            interval: intervalText(cost.interval_value, cost.interval_unit),
                            date: cost.next_due_date,
                          })}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-slate-900">
                          {formatEuros(cost.amount)}
                        </span>
                        {cost.backlog_count > 0 && (
                          <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                            {formatMessage({ id: 'recurringCosts.backlog' }, { count: cost.backlog_count })}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={formatMessage({ id: 'recurringCosts.editLabel' }, { name: cost.name })}
                      onClick={() => setModal({ kind: 'edit', cost })}
                      className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
                    >
                      ✎
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {frozenCosts !== null && frozenCosts.length > 0 && (
            <div className="mt-5">
              <button
                type="button"
                aria-expanded={frozenExpanded}
                onClick={() => setFrozenExpanded((open) => !open)}
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
              >
                {formatMessage({ id: 'recurringCosts.frozen.header' }, { count: frozenCosts.length })}
              </button>
              {frozenExpanded && (
                <ul className="mt-2 space-y-3">
                  {frozenCosts.map((cost) => (
                    <li key={cost.id}>
                      <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() =>
                            requestLedgerFilter?.({ kind: 'recurring-cost', id: cost.id })
                          }
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 pr-2 text-left"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">
                              {cost.name}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {formatMessage({ id: 'recurringCosts.nextDueFrozen' }, {
                                interval: intervalText(cost.interval_value, cost.interval_unit),
                              })}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold text-slate-900">
                            {formatEuros(cost.amount)}
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={formatMessage({ id: 'recurringCosts.editLabel' }, { name: cost.name })}
                          onClick={() => setModal({ kind: 'edit', cost })}
                          className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
                        >
                          ✎
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {modal !== null && (
        <RecurringCostModal
          cost={modal.kind === 'edit' ? modal.cost : undefined}
          onSaved={handleSaved}
          onFreeze={handleFreeze}
          onUnfreeze={handleUnfreeze}
          onClose={closeModal}
        />
      )}
    </>
  )
}