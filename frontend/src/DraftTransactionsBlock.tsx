import { useIntl } from 'react-intl'

import {
  formatLedgerDate,
  type Category,
  type DraftTransaction,
  type Wallet,
} from './api'
import { draftIsTransfer, draftSignedAmount } from './draftTransactions'
import { descriptionText } from './transactions'

/** The pinned Drafts block (ADR-0036, issues #122/#123): the Account's
 * Draft Transactions above the ledger, one row per Draft with the same
 * columns as a Transaction row — title, date · wallet, amount — and each
 * missing field visibly marked, so the user sees at a glance what the
 * Assistant did not catch. Discard removes the row at once; Approve and
 * Edit join the actions column in a later ticket (#125). Rendered only
 * when there is at least one Draft; no tab badge (ADR-0036). */
export function DraftTransactionsBlock({
  drafts,
  wallets,
  categories,
  error,
  onDiscard,
}: {
  drafts: DraftTransaction[]
  wallets: Wallet[]
  categories: Category[]
  /** The last Discard failure, shown under the heading; null when none. */
  error: string | null
  onDiscard: (draft: DraftTransaction) => void
}) {
  const { formatMessage } = useIntl()
  if (drafts.length === 0) return null

  const missing = (id: string) => (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
      {formatMessage({ id })}
    </span>
  )

  const walletLabel = (walletId: number | null, missingId: string) => {
    if (walletId === null) return missing(missingId)
    // A referenced Wallet the list does not know was frozen or deleted in
    // between (the FK nulls a deleted one; a frozen one is in the list):
    // shown as missing, which is what Approve will say too.
    const name = wallets.find((w) => w.id === walletId)?.name
    return name === undefined ? missing(missingId) : name
  }

  const title = (draft: DraftTransaction): string => {
    const category =
      draft.category_id === null
        ? null
        : (categories.find((c) => c.id === draft.category_id)?.name ?? null)
    const description = descriptionText(draft.description)
    const parts: string[] = []
    if (category !== null) parts.push(category)
    if (description !== null) parts.push(description)
    if (parts.length > 0) return parts.join(' · ')
    if (draft.type === null) return formatMessage({ id: 'drafts.untitled' })
    return formatMessage({ id: `drafts.type.${draft.type}` })
  }

  return (
    <section
      aria-label={formatMessage({ id: 'drafts.title' })}
      className="mt-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-indigo-900">
          {formatMessage({ id: 'drafts.title' })} ({drafts.length})
        </h3>
        <p className="truncate text-xs text-indigo-700">{formatMessage({ id: 'drafts.hint' })}</p>
      </div>
      {error !== null && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <ul className="mt-2 space-y-2">
        {drafts.map((draft) => {
          const amount = draftSignedAmount(draft)
          return (
            <li
              key={draft.id}
              className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {title(draft)}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-slate-500">
                  {draft.type === null && missing('drafts.missing.type')}
                  {draft.date === null ? missing('drafts.missing.date') : formatLedgerDate(draft.date)}
                  {' · '}
                  {draftIsTransfer(draft) ? (
                    <>
                      {walletLabel(draft.source_wallet_id, 'drafts.missing.source')}
                      {' → '}
                      {walletLabel(draft.destination_wallet_id, 'drafts.missing.destination')}
                    </>
                  ) : (
                    walletLabel(draft.wallet_id, 'drafts.missing.wallet')
                  )}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-slate-900">
                {amount === null ? missing('drafts.missing.amount') : amount}
              </span>
              {/* The actions column: Discard now; Approve and Edit land
                  here with #125. */}
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDiscard(draft)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-red-700"
                >
                  {formatMessage({ id: 'drafts.discard' })}
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
