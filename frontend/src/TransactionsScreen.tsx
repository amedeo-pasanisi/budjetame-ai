import { useEffect, useRef, useState } from 'react'

import {
  PAGE_LIMIT,
  fetchCategories,
  fetchTransactions,
  fetchWallets,
  TOKEN_KEY,
  type Category,
  type Transaction,
  type Wallet,
} from './api'
import { ImportScreen } from './ImportScreen'
import { TransactionModal } from './TransactionModal'
import { signedAmount, hasLocation, transactionTitle } from './transactions'

/** The modal form's draft: create (no Transaction) or edit (a Transaction).
 * Null means the modal is closed (US8–US10). */
type FormDraft = { kind: 'create' } | { kind: 'edit'; transaction: Transaction }

export function TransactionsScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [transactions, setTransactions] = useState<Transaction[] | null>(null)
  // The accumulated list pages one at a time: the sentinel at the bottom of
  // the list (IntersectionObserver) fetches the next page while scrolling.
  // Null while the first page is still loading.
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormDraft | null>(null)
  const [savedWarning, setSavedWarning] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  // Generation counter: any write (save/delete/import) resets the list to the
  // first page; a further page still in flight when that happens must not
  // append its pre-reset rows.
  const generation = useRef(0)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const reload = () => {
    generation.current += 1
    setLoadError(null)
    setSavedWarning(null)
    Promise.all([fetchWallets(token), fetchCategories(token), fetchTransactions(token)])
      .then(([walletData, categoryData, page]) => {
        setWallets(walletData)
        setCategories(categoryData)
        setTransactions(page.items)
        setNextCursor(page.next_cursor)
      })
      .catch(() => setLoadError('Could not load your data.'))
  }

  useEffect(reload, [token])

  const loadMore = () => {
    if (nextCursor === null || loadingMore) {
      return
    }
    const gen = generation.current
    setLoadingMore(true)
    fetchTransactions(token, {}, PAGE_LIMIT, nextCursor)
      .then((page) => {
        if (gen !== generation.current) {
          return
        }
        setTransactions((current) => {
          if (current === null) {
            return page.items
          }
          // The backend's keyset cursor never returns overlapping pages; the
          // id-set is a defensive guard (StrictMode double-effects, stale
          // responses).
          const seen = new Set(current.map((transaction) => transaction.id))
          return [
            ...current,
            ...page.items.filter((transaction) => !seen.has(transaction.id)),
          ]
        })
        setNextCursor(page.next_cursor)
      })
      .catch(() => {
        if (gen === generation.current) {
          setLoadError('Could not load more transactions.')
        }
      })
      .finally(() => setLoadingMore(false))
  }

  // The observer callback must see the latest loadMore without re-observing
  // on every render; the effect re-runs only when the page boundary changes
  // (a re-observe fires the initial callback again, which auto-fills when the
  // sentinel is still visible). A failed loadMore never auto-retries: the
  // sentinel only re-fires on a real intersection change.
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || nextCursor === null) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreRef.current()
        }
      },
      // Fetch before the sentinel reaches the viewport edge.
      { rootMargin: '300px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [nextCursor])

  const walletName = (walletId: number | null): string =>
    walletId === null
      ? 'Frozen wallet'
      : (wallets?.find((w) => w.id === walletId)?.name ?? 'Frozen wallet')

  const categoryName = (categoryId: number | null): string | null => {
    if (categoryId === null) return null
    return categories?.find((c) => c.id === categoryId)?.name ?? null
  }

  const handleSaved = (transaction: Transaction) => {
    setForm(null)
    reload()
    // Set after reload(): reload clears the banner, and the last write in the
    // batch wins — so the warning renders above the reloaded list.
    if (transaction.warning) {
      setSavedWarning('Saved — this made a Cash wallet negative.')
    }
  }

  const handleDeleted = (warning: boolean) => {
    setForm(null)
    reload()
    if (warning) {
      setSavedWarning('Deleted — this made a Cash wallet negative.')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Transactions</h2>
        {!importing && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm({ kind: 'create' })}
              disabled={wallets === null || categories === null}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              New transaction
            </button>
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600"
            >
              Import
            </button>
          </div>
        )}
      </div>

      {importing ? (
        <ImportScreen
          onBack={() => setImporting(false)}
          onDone={() => {
            setImporting(false)
            reload()
          }}
        />
      ) : (
        <>
          {loadError !== null && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
          {savedWarning !== null && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {savedWarning}
            </p>
          )}

          {wallets === null || categories === null || transactions === null ? (
            <p className="mt-3 text-sm text-slate-500">Loading…</p>
          ) : (
            <>
              <h3 className="mt-8 text-sm font-medium text-slate-700">All transactions</h3>
              {transactions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Nothing here yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {transactions.map((transaction) => {
                    // A Transaction on a Wallet that is no longer in the active list
                    // belongs to a frozen Wallet (the only way a Wallet leaves the
                    // list): viewable, but neither editable nor deletable (ADR-0002).
                    // A Transfer is frozen when either leg is frozen.
                    const onFrozenWallet =
                      transaction.type === 'transfer'
                        ? (transaction.source_wallet_id !== null &&
                            wallets.find((w) => w.id === transaction.source_wallet_id) ===
                              undefined) ||
                          (transaction.destination_wallet_id !== null &&
                            wallets.find((w) => w.id === transaction.destination_wallet_id) ===
                              undefined)
                        : wallets.find((w) => w.id === transaction.wallet_id) === undefined
                    const editable =
                      transaction.type !== 'opening_balance' && !onFrozenWallet
                    const category = categoryName(transaction.category_id)
                    const walletLabel =
                      transaction.type === 'transfer'
                        ? `${walletName(transaction.source_wallet_id)} → ${walletName(
                            transaction.destination_wallet_id,
                          )}`
                        : walletName(transaction.wallet_id)
                    return (
                      <li key={transaction.id}>
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => setForm({ kind: 'edit', transaction })}
                          className={`flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm ${
                            editable ? '' : 'opacity-70'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              {transactionTitle(transaction)}
                              {category !== null && ` · ${category}`}
                            </span>
                            <span className="block truncate text-xs text-slate-500">
                              {transaction.date} · {walletLabel}
                              {transaction.description !== null && transaction.description !== ''
                                ? ` · ${transaction.description}`
                                : ''}
                              {hasLocation(transaction) && ' · 📍'}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-slate-900">
                            {signedAmount(transaction)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {nextCursor !== null && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-3 text-xs text-slate-500"
                >
                  {loadingMore ? 'Loading more…' : ''}
                </div>
              )}
            </>
          )}
        </>
      )}

      {form !== null && wallets !== null && categories !== null && (
        <TransactionModal
          wallets={wallets}
          categories={categories}
          editing={form.kind === 'edit' ? form.transaction : null}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setForm(null)}
        />
      )}
    </>
  )
}
