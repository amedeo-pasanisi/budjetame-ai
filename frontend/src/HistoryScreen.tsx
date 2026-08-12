import { useCallback, useEffect, useState } from 'react'

import {
  TOKEN_KEY,
  fetchCategories,
  fetchTransactions,
  fetchWallets,
  formatEuros,
  type Category,
  type Transaction,
  type TransactionFilters,
  type Wallet,
} from './api'
import { TransactionForm } from './TransactionForm'
import { signedAmount, hasLocation, transactionTitle } from './transactions'

const ALL_CATEGORIES = -1

/** Per-Wallet Transaction History (T8): date-range and category filters, the
 * historical Transactions of frozen Wallets included, and edit/delete entry
 * points except on frozen Wallets. */
export function HistoryScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [transactions, setTransactions] = useState<Transaction[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedWalletId, setSelectedWalletId] = useState<number | undefined>(undefined)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [categoryId, setCategoryId] = useState<number>(ALL_CATEGORIES)
  const [editing, setEditing] = useState<Transaction | null>(null)
  // The Cash negative-Balance warning from the last write, when it carries one
  // (US10/ID8: the indicator belongs to writes — delete included).
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Frozen Wallets are included so their history stays reachable (T8).
    Promise.all([fetchWallets(token, true), fetchCategories(token)])
      .then(([walletData, categoryData]) => {
        if (cancelled) return
        setWallets(walletData)
        setCategories(categoryData)
        // Default to the first active Wallet; fall back to any Wallet.
        setSelectedWalletId((current) => {
          if (current !== undefined) return current
          return walletData.find((w) => !w.frozen)?.id ?? walletData[0]?.id
        })
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your data.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const filters = useCallback(
    (): TransactionFilters => ({
      walletId: selectedWalletId,
      categoryId: categoryId === ALL_CATEGORIES ? undefined : categoryId,
      fromDate,
      toDate,
    }),
    [selectedWalletId, categoryId, fromDate, toDate],
  )

  useEffect(() => {
    if (selectedWalletId === undefined) {
      return
    }
    let cancelled = false
    setLoadError(null)
    setEditing(null)
    fetchTransactions(token, filters())
      .then((data) => {
        if (!cancelled) setTransactions(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load transactions.')
      })
    return () => {
      cancelled = true
    }
  }, [token, filters, selectedWalletId])

  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId)
  const walletName = (walletId: number | null): string =>
    walletId === null
      ? 'Frozen wallet'
      : (wallets?.find((w) => w.id === walletId)?.name ?? `Wallet #${walletId}`)

  const categoryName = (categoryId: number | null): string | null => {
    if (categoryId === null) return null
    return categories?.find((c) => c.id === categoryId)?.name ?? null
  }

  // Frozen-Wallet Transactions are viewable but not editable/deletable
  // (ADR-0002). A Transfer is frozen when either leg is frozen — a Wallet can
  // freeze after the Transfer exists, so the check must cover both legs.
  const onFrozenWallet = (transaction: Transaction): boolean => {
    if (transaction.type === 'transfer') {
      const source = wallets?.find((w) => w.id === transaction.source_wallet_id)
      const destination = wallets?.find(
        (w) => w.id === transaction.destination_wallet_id,
      )
      return (
        source === undefined ||
        source.frozen ||
        destination === undefined ||
        destination.frozen
      )
    }
    const wallet = wallets?.find((w) => w.id === transaction.wallet_id)
    return wallet === undefined || wallet.frozen
  }

  const reloadTransactions = () => {
    if (selectedWalletId === undefined) {
      return
    }
    setLoadError(null)
    setNotice(null)
    fetchTransactions(token, filters())
      .then(setTransactions)
      .catch(() => setLoadError('Could not reload transactions.'))
  }

  const handleSaved = () => {
    setEditing(null)
    reloadTransactions()
  }

  const handleDeleted = (warning: boolean) => {
    setEditing(null)
    reloadTransactions()
    // Set after reload(): reload clears the banner, and the last write in the
    // batch wins — so the warning renders above the reloaded list.
    if (warning) {
      setNotice('Deleted — this made a Cash wallet negative.')
    }
  }

  return (
    <>
      <h2 className="font-semibold text-slate-900">History</h2>

      {loadError !== null && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {notice !== null && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {notice}
        </p>
      )}

      {wallets === null || categories === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <label htmlFor="history-wallet" className="block text-sm font-medium text-slate-700">
              Wallet
            </label>
            <select
              id="history-wallet"
              value={selectedWalletId ?? ''}
              onChange={(event) => setSelectedWalletId(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              {wallets.length === 0 && <option value="">No wallets yet</option>}
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                  {wallet.frozen ? ' · Frozen' : ''} ({formatEuros(wallet.balance)})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="history-from" className="block text-sm font-medium text-slate-700">
                From
              </label>
              <input
                id="history-from"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="history-to" className="block text-sm font-medium text-slate-700">
                To
              </label>
              <input
                id="history-to"
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="history-category" className="block text-sm font-medium text-slate-700">
              Category
            </label>
            <select
              id="history-category"
              value={categoryId}
              onChange={(event) => setCategoryId(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value={ALL_CATEGORIES}>All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.icon !== null ? `${category.icon} ` : ''}
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {selectedWallet?.frozen && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          This wallet is frozen — its history is viewable but read-only.
        </p>
      )}

      {transactions === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : transactions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No transactions match these filters.</p>
      ) : (
        <>
          {editing !== null && wallets !== null && categories !== null && (
            <TransactionForm
              key={editing.id}
              wallets={wallets}
              categories={categories}
              editing={editing}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancel={() => setEditing(null)}
            />
          )}

          <ul className="mt-3 space-y-2">
            {transactions.map((transaction) => {
              const category = categoryName(transaction.category_id)
              // Uncategorized expenses/income are labeled (T8); Transfers and
              // Opening Balances never carry a Category.
              const categoryLabel =
                category !== null
                  ? category
                  : transaction.type === 'expense' || transaction.type === 'income'
                    ? 'Uncategorized'
                    : null
              const walletLabel =
                transaction.type === 'transfer'
                  ? `${walletName(transaction.source_wallet_id)} → ${walletName(
                      transaction.destination_wallet_id,
                    )}`
                  : walletName(transaction.wallet_id)
              const rowEditable =
                transaction.type !== 'opening_balance' && !onFrozenWallet(transaction)
              return (
                <li key={transaction.id}>
                  <button
                    type="button"
                    disabled={!rowEditable}
                    onClick={() => setEditing(transaction)}
                    className={`flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm ${
                      rowEditable ? '' : 'opacity-70'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {transactionTitle(transaction)}
                        {categoryLabel !== null && ` · ${categoryLabel}`}
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
        </>
      )}
    </>
  )
}
