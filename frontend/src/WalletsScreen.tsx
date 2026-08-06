import { useEffect, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createWallet,
  fetchWallets,
  renameWallet,
  type Wallet,
  type WalletType,
} from './api'

const TYPE_LABELS: Record<WalletType, string> = {
  checking: 'Checking',
  credit_card: 'Credit Card',
  cash: 'Cash',
  contact: 'Contact',
}

const WALLET_TYPE_OPTIONS = (Object.entries(TYPE_LABELS) as [WalletType, string][]).map(
  ([value, label]) => ({ value, label }),
)

function formatEuros(balance: string): string {
  return `€${balance}`
}

export function WalletsScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Wallet | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWallets(token)
      .then((data) => {
        if (!cancelled) setWallets(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your wallets.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const handleCreated = (wallet: Wallet) => {
    setWallets((current) => (current === null ? [wallet] : [...current, wallet]))
    setShowCreate(false)
  }

  const handleRenamed = (wallet: Wallet) => {
    setWallets((current) =>
      current === null
        ? [wallet]
        : current.map((existing) => (existing.id === wallet.id ? wallet : existing)),
    )
    setEditing(null)
  }

  return (
    <>
      <h2 className="font-semibold text-slate-900">Wallets</h2>

      {loadError !== null && <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>}

      {wallets === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading wallets…</p>
      ) : wallets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No wallets yet. Add your first one to start tracking.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {wallets.map((wallet) => (
            <li key={wallet.id}>
              <button
                type="button"
                onClick={() => setEditing(wallet)}
                className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
              >
                <span>
                  <span className="block font-medium text-slate-900">{wallet.name}</span>
                  <span className="block text-xs text-slate-500">
                    {TYPE_LABELS[wallet.type]}
                  </span>
                </span>
                <span className="font-semibold text-slate-900">
                  {formatEuros(wallet.balance)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!showCreate && editing === null && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="mt-5 w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
        >
          + New wallet
        </button>
      )}

      {showCreate && (
        <WalletCreateForm
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editing !== null && (
        <WalletRenameForm
          wallet={editing}
          onRenamed={handleRenamed}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  )
}

type WalletCreateFormProps = {
  onCreated: (wallet: Wallet) => void
  onCancel: () => void
}

function WalletCreateForm({ onCreated, onCancel }: WalletCreateFormProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<WalletType>('checking')
  const [openingBalance, setOpeningBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const wallet = await createWallet(token, { name, type, openingBalance })
      onCreated(wallet)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(err, 'A wallet with this name already exists.', 'Could not create the wallet.')
          : 'Could not create the wallet.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">New wallet</h2>
      <div>
        <label htmlFor="wallet-name" className="block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="wallet-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Intesa checking"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="wallet-type" className="block text-sm font-medium text-slate-700">
          Type
        </label>
        <select
          id="wallet-type"
          value={type}
          onChange={(event) => setType(event.target.value as WalletType)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          {WALLET_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="opening-balance" className="block text-sm font-medium text-slate-700">
          Opening balance (optional)
        </label>
        <input
          id="opening-balance"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          placeholder="0.00"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Money you already have. Defaults to €0.00.
        </p>
      </div>
      {error !== null && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || name.trim() === ''}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Create wallet'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

type WalletRenameFormProps = {
  wallet: Wallet
  onRenamed: (wallet: Wallet) => void
  onCancel: () => void
}

function WalletRenameForm({ wallet, onRenamed, onCancel }: WalletRenameFormProps) {
  const [name, setName] = useState(wallet.name)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const renamed = await renameWallet(token, wallet.id, name)
      onRenamed(renamed)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(err, 'A wallet with this name already exists.', 'Could not rename the wallet.')
          : 'Could not rename the wallet.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">Rename wallet</h2>
      <p className="text-xs text-slate-500">
        {TYPE_LABELS[wallet.type]} · type cannot be changed
      </p>
      <div>
        <label htmlFor="rename-name" className="block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="rename-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      {error !== null && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || name.trim() === ''}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
