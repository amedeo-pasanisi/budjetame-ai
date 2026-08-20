import { useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createWallet,
  formatEuros,
  freezeWallet,
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

type WalletFormProps = {
  wallet?: Wallet
  /** Eligibility locking (ADR-0013): when set, the Type selector only
   * offers these types — create mode only, for inline creation from a form
   * whose field only accepts some types (e.g. costs accept Checking, Credit
   * Card, and Cash, never Contact). */
  allowedTypes?: WalletType[]
  onSaved: (wallet: Wallet) => void
  onFrozen?: (walletId: number) => void
  onCancel: () => void
}

/** The create/edit/freeze form for a Wallet, hosted in the modal
 * shell (WalletModal) (issue #49). The form itself is unchanged from the
 * inline days: Name, plus a Type selector and an Opening balance only while
 * creating, and the tap-again freeze confirmation only while editing. When
 * `allowedTypes` is set, the Type selector is restricted to those types
 * (ADR-0013), so an inline wallet created from a form field can never be
 * of a type the field would reject. Cancel — like the shell's backdrop and
 * Escape — abandons the draft without saving. */
export function WalletForm({ wallet, allowedTypes, onSaved, onFrozen, onCancel }: WalletFormProps) {
  const editing = wallet !== undefined
  const [name, setName] = useState(wallet?.name ?? '')
  const [type, setType] = useState<WalletType>(
    wallet?.type ?? (allowedTypes !== undefined && !allowedTypes.includes('checking')
      ? allowedTypes[0]
      : 'checking'),
  )
  const [openingBalance, setOpeningBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [freezeError, setFreezeError] = useState<string | null>(null)

  const canFreeze = editing && Number.parseFloat(wallet.balance) === 0

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const saved = editing
        ? await renameWallet(token, wallet.id, name)
        : await createWallet(token, { name, type, openingBalance })
      onSaved(saved)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              'A wallet with this name already exists.',
              editing ? 'Could not rename the wallet.' : 'Could not create the wallet.',
            )
          : editing
            ? 'Could not rename the wallet.'
            : 'Could not create the wallet.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleFreeze = async () => {
    if (wallet === undefined || !canFreeze) {
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
      onFrozen?.(wallet.id)
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
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {editing ? 'Edit wallet' : 'New wallet'}
      </h2>
      {editing && (
        <p className="text-xs text-slate-500">
          {TYPE_LABELS[wallet.type]} · type cannot be changed
        </p>
      )}

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

      {!editing && (
        <>
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
              {WALLET_TYPE_OPTIONS.filter(
                (option) => allowedTypes === undefined || allowedTypes.includes(option.value),
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {allowedTypes !== undefined && (
              <p className="mt-1 text-xs text-slate-500">
                {allowedTypes.map((type) => TYPE_LABELS[type]).join(', ')} · fixed for this
                form
              </p>
            )}
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
        </>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || name.trim() === ''}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : editing ? 'Save' : 'Create wallet'}
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

      {editing && (
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
      )}
    </form>
  )
}
