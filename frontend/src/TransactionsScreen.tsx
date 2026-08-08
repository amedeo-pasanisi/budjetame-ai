import { useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createTransaction,
  deleteTransaction,
  fetchCategories,
  fetchTransactions,
  fetchWallets,
  formatEuros,
  updateTransaction,
  type Category,
  type Transaction,
  type TransactionInput,
  type Wallet,
} from './api'

const NON_CONTACT_WALLET_TYPES = ['checking', 'credit_card', 'cash']

/** Today's date in the app's single fixed timezone (CONTEXT.md: Europe/Rome). */
function todayInRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
}

function signedAmount(transaction: Transaction): string {
  if (transaction.type === 'expense') return `-€${transaction.amount}`
  if (transaction.type === 'income') return `+€${transaction.amount}`
  // A Transfer and an Opening Balance move money without income/expense signs.
  return `€${transaction.amount}`
}

function transactionTitle(transaction: Transaction): string {
  if (transaction.type === 'opening_balance') return 'Opening balance'
  if (transaction.type === 'expense') return 'Expense'
  if (transaction.type === 'income') return 'Income'
  return 'Transfer'
}

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

type TransactionFormProps = {
  wallets: Wallet[]
  categories: Category[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: () => void
  onCancel: () => void
}

function TransactionForm({
  wallets,
  categories,
  editing,
  onSaved,
  onDeleted,
  onCancel,
}: TransactionFormProps) {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>(
    editing?.type === 'transfer'
      ? 'transfer'
      : editing?.type === 'income'
        ? 'income'
        : 'expense',
  )
  const [amount, setAmount] = useState(editing?.amount ?? '')
  const [date, setDate] = useState(editing?.date ?? todayInRome())
  const [walletId, setWalletId] = useState<number | undefined>(
    editing?.type === 'transfer'
      ? undefined
      : (editing?.wallet_id ??
        wallets.filter((w) => NON_CONTACT_WALLET_TYPES.includes(w.type))[0]?.id),
  )
  const [sourceWalletId, setSourceWalletId] = useState<number | undefined>(
    editing?.type === 'transfer' ? (editing.source_wallet_id ?? undefined) : wallets[0]?.id,
  )
  const [destinationWalletId, setDestinationWalletId] = useState<number | undefined>(
    editing?.type === 'transfer'
      ? (editing.destination_wallet_id ?? undefined)
      : (wallets[1]?.id ?? wallets[0]?.id),
  )
  const [categoryId, setCategoryId] = useState<number | null>(editing?.category_id ?? null)
  const [description, setDescription] = useState(editing?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isEditing = editing !== null
  const isTransfer = type === 'transfer'
  const spendableWallets = wallets.filter((w) =>
    NON_CONTACT_WALLET_TYPES.includes(w.type),
  )
  const matchingCategories = categories.filter((c) => c.type === type)

  const sourceWallet = wallets.find((w) => w.id === sourceWalletId)
  const destinationWallet = wallets.find((w) => w.id === destinationWalletId)
  const selectedWallet = wallets.find((w) => w.id === walletId)
  const amountValue = Number.parseFloat(amount)
  const hasAmount = !Number.isNaN(amountValue) && amountValue > 0
  const projectedBalance = useMemo(() => {
    if (isTransfer) {
      if (sourceWallet === undefined || !hasAmount) return null
      return Number.parseFloat(sourceWallet.balance) - amountValue
    }
    if (selectedWallet === undefined || !hasAmount) return null
    const current = Number.parseFloat(selectedWallet.balance)
    const delta = type === 'expense' ? -amountValue : amountValue
    return current + delta
  }, [sourceWallet, selectedWallet, hasAmount, amountValue, type, isTransfer])

  const willWarn =
    (isTransfer ? sourceWallet?.type === 'cash' : selectedWallet?.type === 'cash') &&
    projectedBalance !== null &&
    projectedBalance < 0

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const input: TransactionInput = isTransfer
        ? {
            type: 'transfer',
            amount,
            date,
            sourceWalletId: sourceWalletId as number,
            destinationWalletId: destinationWalletId as number,
            description,
          }
        : {
            type,
            amount,
            date,
            walletId: walletId as number,
            categoryId,
            description,
          }
      const saved =
        isEditing && editing !== null
          ? await updateTransaction(token, editing.id, {
              amount,
              date,
              description,
              ...(isTransfer ? {} : { categoryId }),
            })
          : await createTransaction(token, input)
      onSaved(saved)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              'A wallet or category with this name already exists.',
              isEditing ? 'Could not save the transaction.' : 'Could not create the transaction.',
            )
          : 'Something went wrong.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (editing === null) {
      return
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      await deleteTransaction(token, editing.id)
      onDeleted()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(err, 'A wallet or category with this name already exists.', 'Could not delete the transaction.')
          : 'Something went wrong.',
      )
      setSubmitting(false)
    }
  }

  const resetForm = () => {
    setType('expense')
    setAmount('')
    setDate(todayInRome())
    setWalletId(wallets[0]?.id)
    setSourceWalletId(wallets[0]?.id)
    setDestinationWalletId(wallets[1]?.id ?? wallets[0]?.id)
    setCategoryId(null)
    setDescription('')
    setError(null)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="font-medium text-slate-900">
        {isEditing ? 'Edit transaction' : 'New transaction'}
      </h3>

      <div className="flex gap-2">
        <TypeButton
          active={type === 'expense'}
          disabled={isEditing}
          onClick={() => setType('expense')}
        >
          Expense
        </TypeButton>
        <TypeButton
          active={type === 'income'}
          disabled={isEditing}
          onClick={() => setType('income')}
        >
          Income
        </TypeButton>
        <TypeButton
          active={type === 'transfer'}
          disabled={isEditing}
          onClick={() => setType('transfer')}
        >
          Transfer
        </TypeButton>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="tx-amount" className="block text-sm font-medium text-slate-700">
            Amount (€)
          </label>
          <input
            id="tx-amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="tx-date" className="block text-sm font-medium text-slate-700">
            Date
          </label>
          <input
            id="tx-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        </div>
      </div>

      {isTransfer ? (
        <div className="grid grid-cols-2 gap-3">
          <WalletSelect
            id="tx-source"
            label="From"
            wallets={wallets}
            value={sourceWalletId}
            disabled={isEditing}
            onChange={setSourceWalletId}
          />
          <WalletSelect
            id="tx-destination"
            label="To"
            wallets={wallets}
            value={destinationWalletId}
            disabled={isEditing}
            onChange={setDestinationWalletId}
          />
        </div>
      ) : (
        <div>
          <label htmlFor="tx-wallet" className="block text-sm font-medium text-slate-700">
            Wallet
          </label>
          <select
            id="tx-wallet"
            required
            disabled={isEditing}
            value={walletId ?? ''}
            onChange={(event) => setWalletId(Number(event.target.value))}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
          >
            {spendableWallets.length === 0 && <option value="">No spendable wallets</option>}
            {spendableWallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.name} ({formatEuros(wallet.balance)})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Contact wallets only move money through transfers.
          </p>
        </div>
      )}

      {isTransfer ? (
        sourceWallet !== undefined && destinationWallet !== undefined && hasAmount ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {sourceWallet.name}: {formatEuros(sourceWallet.balance)} →{' '}
            <span className="font-semibold">
              {formatEuros((Number.parseFloat(sourceWallet.balance) - amountValue).toFixed(2))}
            </span>
            <span className="mx-1">·</span>
            {destinationWallet.name}: {formatEuros(destinationWallet.balance)} →{' '}
            <span className="font-semibold">
              {formatEuros((Number.parseFloat(destinationWallet.balance) + amountValue).toFixed(2))}
            </span>
            {willWarn && (
              <span className="mt-1 block text-amber-700">
                ⚠ This will make your Cash wallet negative.
              </span>
            )}
          </p>
        ) : null
      ) : selectedWallet !== undefined && projectedBalance !== null ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {selectedWallet.name}: {formatEuros(selectedWallet.balance)} →{' '}
          <span className="font-semibold">{formatEuros(projectedBalance.toFixed(2))}</span>
          {willWarn && (
            <span className="mt-1 block text-amber-700">
              ⚠ This will make your Cash wallet negative.
            </span>
          )}
        </p>
      ) : null}

      {isTransfer ? (
        <p className="text-xs text-slate-500">Transfers never carry a category.</p>
      ) : (
        <div>
          <label htmlFor="tx-category" className="block text-sm font-medium text-slate-700">
            Category
          </label>
          <select
            id="tx-category"
            value={categoryId ?? ''}
            onChange={(event) =>
              setCategoryId(event.target.value === '' ? null : Number(event.target.value))
            }
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">None</option>
            {matchingCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.icon !== null ? `${category.icon} ` : ''}
                {category.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="tx-description" className="block text-sm font-medium text-slate-700">
          Description
        </label>
        <input
          id="tx-description"
          type="text"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional note"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={
            submitting ||
            !hasAmount ||
            (isTransfer
              ? sourceWalletId === undefined ||
                destinationWalletId === undefined ||
                sourceWalletId === destinationWalletId
              : walletId === undefined)
          }
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : isEditing ? 'Save' : 'Save transaction'}
        </button>
        <button
          type="button"
          onClick={isEditing ? onCancel : resetForm}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
        >
          {isEditing ? 'Cancel' : 'Clear'}
        </button>
      </div>

      {isEditing && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={submitting}
          className={`w-full rounded-lg border px-4 py-2 text-sm font-medium ${
            confirmingDelete
              ? 'border-red-600 bg-red-600 text-white'
              : 'border-red-200 text-red-600'
          }`}
        >
          {submitting ? 'Deleting…' : confirmingDelete ? 'Tap again to confirm' : 'Delete transaction'}
        </button>
      )}
    </form>
  )
}

function TypeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
      } disabled:opacity-60`}
    >
      {children}
    </button>
  )
}

function WalletSelect({
  id,
  label,
  wallets,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  wallets: Wallet[]
  value: number | undefined
  disabled: boolean
  onChange: (walletId: number) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        required
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
      >
        {wallets.length === 0 && <option value="">No wallets yet</option>}
        {wallets.map((wallet) => (
          <option key={wallet.id} value={wallet.id}>
            {wallet.name} ({formatEuros(wallet.balance)})
          </option>
        ))}
      </select>
    </div>
  )
}
