import { useEffect, useMemo, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createWallet,
  fetchWallets,
  formatEuros,
  formatSignedEuros,
  freezeWallet,
  renameWallet,
  unfreezeWallet,
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

// Section headers are plural, like the Categories tab's Expenses/Incomes;
// "Cash" has no English plural. Row subtitles keep the singular labels above.
const SECTION_LABELS: Record<WalletType, string> = {
  contact: 'Contacts',
  checking: 'Checking Accounts',
  credit_card: 'Credit Cards',
  cash: 'Cash',
}

// Fixed order: Contacts first, so who owes me / whom do I owe is answered the
// moment the tab opens (issue #47).
const SECTION_TYPES: WalletType[] = ['contact', 'checking', 'credit_card', 'cash']

export function WalletsScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Wallet | null>(null)
  const [frozenExpanded, setFrozenExpanded] = useState(false)
  const [unfreezeError, setUnfreezeError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Frozen Wallets come along for the collapsed Frozen Wallets list (#48).
    fetchWallets(token, true)
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

  const handleFrozen = (walletId: number) => {
    // The Wallet stays in state, flipping to frozen: it moves from its type
    // section into the Frozen Wallets list (issue #48).
    setWallets((current) =>
      current === null
        ? current
        : current.map((existing) =>
            existing.id === walletId ? { ...existing, frozen: true } : existing,
          ),
    )
    setEditing(null)
  }

  const handleUnfrozen = async (wallet: Wallet) => {
    setUnfreezeError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const unfrozen = await unfreezeWallet(token, wallet.id)
      setWallets((current) =>
        current === null
          ? current
          : current.map((existing) => (existing.id === unfrozen.id ? unfrozen : existing)),
      )
    } catch {
      setUnfreezeError('Could not unfreeze the wallet.')
    }
  }

  // The sections are derived at render time: group by type in the fixed
  // order and sort A→Z case-insensitively, so a new or renamed Wallet lands
  // at the sorted position of its section (issue #47). Frozen Wallets live in
  // the separate Frozen Wallets list, never in the type sections (#48).
  const sections = useMemo(() => {
    if (wallets === null) {
      return null
    }
    return SECTION_TYPES.map((type) => ({
      type,
      label: SECTION_LABELS[type],
      items: wallets
        .filter((wallet) => wallet.type === type && !wallet.frozen)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    }))
  }, [wallets])

  // One flat A→Z list across types, matching the active sections' sort (#48).
  const frozenWallets = useMemo(() => {
    if (wallets === null) {
      return []
    }
    return wallets
      .filter((wallet) => wallet.frozen)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [wallets])

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
        sections
          ?.filter((section) => section.items.length > 0)
          .map((section) => (
            <section
              key={section.type}
              aria-labelledby={`wallets-${section.type}`}
              className="mt-5"
            >
              <h3
                id={`wallets-${section.type}`}
                className="text-sm font-medium text-slate-700"
              >
                {section.label}
              </h3>
              <ul className="mt-2 space-y-3">
                {section.items.map((wallet) => (
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
                        {formatSignedEuros(wallet.balance)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}

      {frozenWallets.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={frozenExpanded}
            onClick={() => setFrozenExpanded((open) => !open)}
            className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
          >
            Frozen wallets ({frozenWallets.length})
          </button>
          {frozenExpanded && (
            <ul className="mt-2 space-y-3">
              {frozenWallets.map((wallet) => (
                <li key={wallet.id}>
                  <button
                    type="button"
                    onClick={() => handleUnfrozen(wallet)}
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
                  >
                    <span>
                      <span className="block font-medium text-slate-900">{wallet.name}</span>
                      <span className="block text-xs text-slate-500">
                        {TYPE_LABELS[wallet.type]} · Frozen
                      </span>
                    </span>
                    <span className="font-semibold text-slate-900">
                      {formatSignedEuros(wallet.balance)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unfreezeError !== null && (
            <p className="mt-2 text-sm text-red-600">{unfreezeError}</p>
          )}
        </div>
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
          key="new-wallet"
          onCreated={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editing !== null && (
        <WalletEditForm
          key={editing.id}
          wallet={editing}
          onRenamed={handleRenamed}
          onFrozen={handleFrozen}
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
          disabled={type === 'contact'}
          value={openingBalance}
          onChange={(event) => setOpeningBalance(event.target.value)}
          placeholder="0.00"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-slate-500">
          {type === 'contact'
            ? 'Contact wallets start at €0 — money moves only through transfers.'
            : 'Money you already have. Defaults to €0.00.'}
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

type WalletEditFormProps = {
  wallet: Wallet
  onRenamed: (wallet: Wallet) => void
  onFrozen: (walletId: number) => void
  onCancel: () => void
}

function WalletEditForm({ wallet, onRenamed, onFrozen, onCancel }: WalletEditFormProps) {
  const [name, setName] = useState(wallet.name)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [freezeError, setFreezeError] = useState<string | null>(null)

  const canFreeze = Number.parseFloat(wallet.balance) === 0

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

  const handleFreeze = async () => {
    if (!canFreeze) {
      return
    }
    if (!confirmingFreeze) {
      setConfirmingFreeze(true)
      setFreezeError(null)
      return
    }
    setFreezing(true)
    setFreezeError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      await freezeWallet(token, wallet.id)
      onFrozen(wallet.id)
    } catch (err) {
      setConfirmingFreeze(false)
      setFreezeError(
        err instanceof ApiError && err.status === 422
          ? 'A wallet can only be frozen when its balance is exactly €0.00.'
          : 'Could not freeze the wallet.',
      )
      setFreezing(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">Edit wallet</h2>
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

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-medium text-slate-900">Freeze wallet</h3>
        <p className="mt-1 text-xs text-slate-500">
          Hides the wallet and makes it read-only. Only possible at €0.00 balance;
          its transactions stay visible.
        </p>
        {freezeError !== null && <p className="mt-2 text-sm text-red-600">{freezeError}</p>}
        <button
          type="button"
          onClick={handleFreeze}
          disabled={!canFreeze || freezing || submitting}
          className={`mt-3 w-full rounded-lg border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
            confirmingFreeze
              ? 'border-red-600 bg-red-600 text-white'
              : 'border-red-200 text-red-600'
          }`}
        >
          {freezing
            ? 'Freezing…'
            : !canFreeze
              ? `Freeze requires €0.00 balance (currently ${formatEuros(wallet.balance)})`
              : confirmingFreeze
                ? 'Tap again to confirm freeze'
                : 'Freeze wallet'}
        </button>
      </div>
    </form>
  )
}
