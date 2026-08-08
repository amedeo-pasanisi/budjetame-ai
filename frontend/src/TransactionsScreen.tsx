import { useEffect, useState } from 'react'

import {
  fetchCategories,
  fetchTransactions,
  fetchWallets,
  TOKEN_KEY,
  type Category,
  type Transaction,
  type Wallet,
} from './api'
import {
  TransactionForm,
} from './TransactionForm'
import { signedAmount, transactionTitle } from './transactions'

export function TransactionsScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [transactions, setTransactions] = useState<Transaction[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [savedWarning, setSavedWarning] = useState<string | null>(null)

  const reload = () => {
    setLoadError(null)
    setSavedWarning(null)
    Promise.all([fetchWallets(token), fetchCategories(token), fetchTransactions(token)])
      .then(([walletData, categoryData, transactionData]) => {
        setWallets(walletData)
        setCategories(categoryData)
        setTransactions(transactionData)
      })
      .catch(() => setLoadError('Could not load your data.'))
  }

  useEffect(reload, [token])

  const walletName = (walletId: number | null): string =>
    walletId === null
      ? 'Frozen wallet'
      : (wallets?.find((w) => w.id === walletId)?.name ?? 'Frozen wallet')

  const categoryName = (categoryId: number | null): string | null => {
    if (categoryId === null) return null
    return categories?.find((c) => c.id === categoryId)?.name ?? null
  }

  const handleSaved = (transaction: Transaction) => {
    setEditing(null)
    if (transaction.warning) {
      setSavedWarning('Saved — this made a Cash wallet negative.')
    }
    reload()
  }

  const handleDeleted = () => {
    setEditing(null)
    reload()
  }

  return (
    <>
      <h2 className="font-semibold text-slate-900">Transactions</h2>

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
          <TransactionForm
            key={editing?.id ?? 'create'}
            wallets={wallets}
            categories={categories}
            editing={editing}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCancel={() => setEditing(null)}
          />

          <h3 className="mt-8 text-sm font-medium text-slate-700">Recent transactions</h3>
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
                      onClick={() => setEditing(transaction)}
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
        </>
      )}
    </>
  )
}
