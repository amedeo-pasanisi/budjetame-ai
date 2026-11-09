import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'

import type { LedgerFilterRequest } from './App'
import { TOKEN_KEY, formatEuros, type RecurringDefinition } from './api'
import { useDataVersion } from './api/dataVersion'
import { RecurringDefinitionModal } from './RecurringDefinitionModal'
import { intervalText, sortByNextDue } from './recurringDisplay'
import { SIDES, type RecurringSide } from './recurringSide'

/** The modal's draft: create (no definition) or edit (a definition). Null
 * means the modal is closed — one modal serves both, like the Wallets and
 * Categories tabs (issue #49). */
type ModalDraft =
  | { kind: 'create' }
  | { kind: 'edit'; definition: RecurringDefinition }

/** One side of the Recurring tab — Costs or Incomes, one screen, the side
 * as a value (issues #56, #60; ADR-0011, ADR-0033): every definition
 * sorted by next due date — the screen's one order — each row showing
 * name, amount, interval, the next due date (derived on the backend), and
 * the Backlog badge (issues #58, #62): the red "N unpaid" badge that
 * answers the original question — what remains to pay, or to receive
 * (ADR-0025). Create, edit, and freeze live in a modal.
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
export function RecurringDefinitionsScreen({
  side,
  requestLedgerFilter,
}: {
  /** Which side the screen shows: its list call, its catalog strings and
   * its Ledger jump kind come from the side table. */
  side: RecurringSide
  /** Send a ledger jump (issue #90): open the Transactions tab with the
   * ledger pre-filtered to one definition. Fired by the whole-row tap
   * surface (ADR-0026). Optional so tests can render the screen bare. */
  requestLedgerFilter?: (request: LedgerFilterRequest) => void
}) {
  const { formatMessage } = useIntl()
  const { api, messages, jumpKind } = SIDES[side]
  /** One of the side's screen strings. */
  const text = (key: string, values?: Record<string, string | number | null>) =>
    formatMessage({ id: `${messages.screen}.${key}` }, values)
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [definitions, setDefinitions] = useState<RecurringDefinition[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  const [frozenExpanded, setFrozenExpanded] = useState(false)
  // The cache clock (ADR-0022): a write anywhere re-fetches this list in
  // the background, so the tab is never stale when switched back to.
  const dataVersion = useDataVersion()
  const loadErrorText = text('loadError')

  // Active and frozen definitions, split from the fetched set
  // (include_frozen=true on the fetch for the collapsed Frozen Recurring
  // section, ADR-0028).
  const active = useMemo(
    () => definitions?.filter((definition) => !definition.frozen) ?? null,
    [definitions],
  )
  const frozen = useMemo(
    () => definitions?.filter((definition) => definition.frozen) ?? null,
    [definitions],
  )

  useEffect(() => {
    let cancelled = false
    api
      .fetchAll(token, true)
      .then((loaded) => {
        if (cancelled) return
        setDefinitions(sortByNextDue(loaded))
      })
      .catch(() => {
        if (!cancelled) setLoadError(loadErrorText)
      })
    return () => {
      cancelled = true
    }
  }, [api, token, dataVersion, loadErrorText])

  const closeModal = () => {
    setModal(null)
  }

  /** Upsert the saved definition and keep the one order. */
  const upsert = (saved: RecurringDefinition) => {
    setDefinitions((current) => {
      if (current === null) {
        return [saved]
      }
      return sortByNextDue(
        current.some((existing) => existing.id === saved.id)
          ? current.map((existing) => (existing.id === saved.id ? saved : existing))
          : [...current, saved],
      )
    })
    closeModal()
  }

  /** One row's card: the main tap surface (the ledger jump) and the
   * trailing ✎ button. Frozen rows read the frozen next-due text and carry
   * no badge: a frozen definition's Timeline generates nothing (ADR-0028). */
  const row = (definition: RecurringDefinition) => (
    <li key={definition.id}>
      <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => requestLedgerFilter?.({ kind: jumpKind, id: definition.id })}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 pr-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-900">
              {definition.name}
            </span>
            <span className="block truncate text-xs text-slate-500">
              {definition.frozen
                ? text('nextDueFrozen', {
                    interval: intervalText(definition.interval_value, definition.interval_unit),
                  })
                : text('nextDue', {
                    interval: intervalText(definition.interval_value, definition.interval_unit),
                    date: definition.next_due_date,
                  })}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-semibold text-slate-900">
              {formatEuros(definition.amount)}
            </span>
            {!definition.frozen && definition.backlog_count > 0 && (
              <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                {text('backlog', { count: definition.backlog_count })}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          aria-label={text('editLabel', { name: definition.name })}
          onClick={() => setModal({ kind: 'edit', definition })}
          className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
        >
          ✎
        </button>
      </div>
    </li>
  )

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">{text('title')}</h2>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          {text('new')}
        </button>
      </div>

      {loadError !== null && <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>}

      {definitions === null ? (
        <p className="mt-3 text-sm text-slate-500">{text('loading')}</p>
      ) : active !== null && active.length === 0 && frozen?.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{text('empty')}</p>
      ) : (
        <>
          {active !== null && active.length > 0 && (
            <ul className="mt-4 space-y-2">{active.map(row)}</ul>
          )}

          {frozen !== null && frozen.length > 0 && (
            <div className="mt-5">
              <button
                type="button"
                aria-expanded={frozenExpanded}
                onClick={() => setFrozenExpanded((open) => !open)}
                className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
              >
                {text('frozen.header', { count: frozen.length })}
              </button>
              {frozenExpanded && <ul className="mt-2 space-y-3">{frozen.map(row)}</ul>}
            </div>
          )}
        </>
      )}

      {modal !== null && (
        <RecurringDefinitionModal
          side={side}
          definition={modal.kind === 'edit' ? modal.definition : undefined}
          onSaved={upsert}
          onFreeze={upsert}
          onUnfreeze={upsert}
          onClose={closeModal}
        />
      )}
    </>
  )
}
