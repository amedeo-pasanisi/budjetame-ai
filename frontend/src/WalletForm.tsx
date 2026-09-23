import { useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createWallet,
  formatEuros,
  freezeWallet,
  unfreezeWallet,
  renameWallet,
  type Wallet,
  type WalletType,
} from './api'
import { FieldError } from './FieldError'
import { fieldErrorProps, parseAmount, type FieldErrors } from './validation'

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
  /** The create form's prefilled Name (issue #77), e.g. the row editor's
   * missing name from the file. Create mode only: an edited Wallet keeps
   * its own name. */
  prefillName?: string
  onSaved: (wallet: Wallet) => void
  onFrozen?: (walletId: number) => void
  onUnfrozen?: (wallet: Wallet) => void
  onCancel: () => void
}

/** Submit-and-validate (ADR-0029): the Wallet form's pure validation,
 * returning one Field Error per wrong field — keyed by the error keys the
 * fields render under — and nothing for a valid form. Runs on every Save
 * click before any API call; a form with errors submits nothing. Name is
 * required in both create and edit. The Opening balance (create only) is
 * a tolerant Amount Input: empty stays valid — the Wallet starts at €0 —
 * then the shared parser's kinds, an unparseable value (letters, signs,
 * malformed groupings) is one message and a parseable-but-not-positive
 * one another, because an Opening balance is a money amount. */
function validate(name: string, openingBalance: string): FieldErrors {
  const errors: FieldErrors = {}
  if (name.trim() === '') {
    errors.name = 'Enter a name'
  }
  const trimmedBalance = openingBalance.trim()
  if (trimmedBalance !== '' && parseAmount(trimmedBalance) === null) {
    // parseAmount reads a finite positive number, or null for everything
    // else. Split the nulls the way users experience them: text that is
    // not an amount at all vs a number that just is not positive.
    errors.openingBalance = /^-?\d+([.,]\d+)?$/.test(trimmedBalance)
      ? 'Amount must be a positive number'
      : "That doesn't look like an amount — use digits and one . or , for decimals"
  }
  return errors
}

/** The create/edit/freeze form for a Wallet, hosted in the modal
 * shell (WalletModal) (issue #49). The form itself is unchanged from the
 * inline days: Name, plus a Type selector and an Opening balance only while
 * creating, and the tap-again freeze confirmation only while editing. Validation is submit-and-validate (ADR-0029): Save is always clickable except
 * while work is in flight, and an invalid draft reveals Field Errors under
 * its wrong fields instead of calling the API — an empty Name, or an
 * Opening balance that is not a positive amount; an empty Opening balance
 * stays valid (the Wallet starts at €0). The Opening balance is a tolerant
 * Amount Input (ADR-0029): a text field read by parseAmount, so both
 * separators work and the created Wallet carries the canonical cents. When
 * `allowedTypes` is set, the Type selector is restricted to those types
 * (ADR-0013), so an inline wallet created from a form field can never be
 * of a type the field would reject. Cancel — like the shell's backdrop and
 * Escape — abandons the draft without saving. */
export function WalletForm({
  wallet,
  allowedTypes,
  prefillName,
  onSaved,
  onFrozen,
  onUnfrozen,
  onCancel,
}: WalletFormProps) {
  const editing = wallet !== undefined
  const readOnly = wallet?.frozen === true
  const [name, setName] = useState(wallet?.name ?? prefillName ?? '')
  const [type, setType] = useState<WalletType>(
    wallet?.type ?? (allowedTypes !== undefined && !allowedTypes.includes('checking')
      ? allowedTypes[0]
      : 'checking'),
  )
  const [openingBalance, setOpeningBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Field Errors (ADR-0029): revealed by a Save attempt, they persist
  // while the user types and refresh only on the next Save click — never
  // live, never on blur.
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const [freezeError, setFreezeError] = useState<string | null>(null)

  const canFreeze = editing && Number.parseFloat(wallet.balance) === 0

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Submit-and-validate (ADR-0029): judge the draft first. Any Field
    // Error reveals inline under its field, and the submit ends here —
    // nothing reaches the API. A valid draft clears the errors (they
    // refresh only on this next Save attempt) and proceeds exactly as
    // before.
    const fieldErrors = validate(name, openingBalance)
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const saved = editing
        ? await renameWallet(token, wallet.id, name)
        : await createWallet(token, {
            name,
            type,
            // The tolerant Amount Input (ADR-0029) sends the canonical
            // cents value — "17,5" or "1.000,45" reach the API as
            // "17.50"/"1000.45". An empty Opening balance stays '' — the
            // API client emits the "0.00" balance: the Wallet starts at €0.
            openingBalance:
              openingBalance.trim() === ''
                ? ''
                : (parseAmount(openingBalance) ?? 0).toFixed(2),
          })
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

  const handleUnfreeze = async () => {
    if (wallet === undefined || !wallet.frozen) {
      return
    }
    setFreezing(true)
    setFreezeError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      await unfreezeWallet(token, wallet.id)
      onUnfrozen?.(wallet)
    } catch {
      setFreezeError('Could not unfreeze the wallet.')
      setFreezing(false)
    }
  }

  return (
    // noValidate (ADR-0029): the browser's native bubbles never appear;
    // the Field Errors are the only validation voice.
    <form
      onSubmit={handleSubmit}
      noValidate
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
        <label htmlFor={readOnly ? undefined : "wallet-name"} className="block text-sm font-medium text-slate-700">
          Name
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{name}</p>
        ) : (
          <input
            id="wallet-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Intesa checking"
            {...fieldErrorProps('name', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="name" errors={errors} />
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
              // The browser-owned type="number" swallowed "17.5" in
              // comma-locales (ADR-0029): parsing is ours now — a tolerant
              // text field read by parseAmount, with the Error's aria
              // wiring.
              type="text"
              inputMode="decimal"
              disabled={type === 'contact'}
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.target.value)}
              placeholder="0.00"
              {...fieldErrorProps('openingBalance', errors)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:opacity-60"
            />
            <FieldError field="openingBalance" errors={errors} />
            <p className="mt-1 text-xs text-slate-500">
              {type === 'contact'
                ? 'Contact wallets start at €0 — money moves only through transfers.'
                : 'Money you already have. Defaults to €0.00.'}
            </p>
          </div>
        </>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      {!readOnly && (
        <div className="flex gap-3">
          {/* Submit-and-validate (ADR-0029): disabled only while work is
          actually in flight (submitting or freezing) — never because the
          draft is invalid. An invalid draft reveals Field Errors instead
          of a dead button. */}
          <button
            type="submit"
            disabled={submitting || freezing}
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
      )}

      {editing && readOnly && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleUnfreeze}
            disabled={freezing || submitting}
            className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100"
          >
            {freezing ? 'Unfreezing…' : 'Unfreeze wallet'}
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
      )}

      {editing && !readOnly && (
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
