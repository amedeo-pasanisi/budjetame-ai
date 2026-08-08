import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createTransaction,
  deleteTransaction,
  formatEuros,
  updateTransaction,
  type Category,
  type Transaction,
  type TransactionInput,
  type Wallet,
} from './api'
import { MapPicker } from './MapPicker'
import {
  formatLocation,
  getGpsPosition,
  gpsPrefillAvailable,
  latLngFromWire,
  latLngToWire,
  mapLink,
  markGpsGranted,
  type LatLng,
} from './location'
import { todayInRome } from './transactions'

const NON_CONTACT_WALLET_TYPES = ['checking', 'credit_card', 'cash']

type TransactionFormProps = {
  wallets: Wallet[]
  categories: Category[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: () => void
  onCancel: () => void
}

/** The create/edit/delete form for a Transaction (Expense, Income, or
 * Transfer), shared by the Transactions tab and the History screen. */
export function TransactionForm({
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
  const [location, setLocation] = useState<LatLng | null>(() =>
    latLngFromWire(editing?.latitude ?? null, editing?.longitude ?? null),
  )
  const [showingPicker, setShowingPicker] = useState(false)
  // Set once the user removes the location: the first-save prompt must not
  // silently re-attach a position the user opted out of (consent, US7/T9).
  const [locationOptedOut, setLocationOptedOut] = useState(false)
  // Set once the user changes the location themselves, so a pending GPS prefill
  // cannot overwrite an explicit choice.
  const locationTouched = useRef(false)
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

  // GPS prefill (US18 / T9): when creating a Transaction and device-location
  // permission is already granted, pre-fill the location from the current
  // position so recording takes one tap. The browser never prompts here — it
  // only prompts on the first save (below). A user-chosen or user-removed
  // location is never overwritten by a pending prefill.
  useEffect(() => {
    if (isEditing) {
      return
    }
    let cancelled = false
    gpsPrefillAvailable().then((available) => {
      if (!available || cancelled) return
      getGpsPosition().then((position) => {
        if (position !== null && !cancelled && !locationTouched.current) {
          setLocation(position)
          markGpsGranted()
        }
      })
    })
    return () => {
      cancelled = true
    }
  }, [isEditing])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      // First-save permission (US7 / T9): when creating without a location, ask
      // for device-location permission — the browser prompts exactly once — and
      // attach the position when granted. A location the user removed
      // (locationOptedOut) or picked explicitly is never overridden.
      let finalLocation = location
      if (!isEditing && finalLocation === null && !locationOptedOut) {
        finalLocation = await getGpsPosition()
        if (finalLocation !== null) {
          setLocation(finalLocation)
          markGpsGranted()
        }
      }
      const input: TransactionInput = isTransfer
        ? {
            type: 'transfer',
            amount,
            date,
            sourceWalletId: sourceWalletId as number,
            destinationWalletId: destinationWalletId as number,
            description,
            ...latLngToWire(finalLocation),
          }
        : {
            type,
            amount,
            date,
            walletId: walletId as number,
            categoryId,
            description,
            ...latLngToWire(finalLocation),
          }
      const saved =
        isEditing && editing !== null
          ? await updateTransaction(token, editing.id, {
              amount,
              date,
              description,
              ...(isTransfer ? {} : { categoryId }),
              ...latLngToWire(location),
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

  const pickFromGps = async () => {
    const position = await getGpsPosition()
    if (position !== null) {
      locationTouched.current = true
      setLocation(position)
      setShowingPicker(false)
      markGpsGranted()
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
    setLocation(null)
    setShowingPicker(false)
    setLocationOptedOut(false)
    locationTouched.current = false
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

      <div>
        <span className="block text-sm font-medium text-slate-700">Location</span>
        {location !== null ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-700">📍 {formatLocation(location)}</span>
            <a
              href={mapLink(location)}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-indigo-600"
            >
              Open in Google Maps ↗
            </a>
            <button
              type="button"
              onClick={() => {
                locationTouched.current = true
                setLocationOptedOut(true)
                setLocation(null)
                setShowingPicker(false)
              }}
              className="text-sm font-medium text-red-600"
            >
              Remove
            </button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-500">No location attached.</p>
        )}
        {showingPicker ? (
          <div className="mt-2 space-y-2">
            <MapPicker
              position={location}
              onPick={(picked) => {
                locationTouched.current = true
                setLocation(picked)
                setShowingPicker(false)
              }}
            />
            <button
              type="button"
              onClick={() => setShowingPicker(false)}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={() => setShowingPicker(true)}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
            >
              {location !== null ? 'Change location' : 'Add location'}
            </button>
            <button
              type="button"
              onClick={pickFromGps}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
            >
              Use my location
            </button>
          </div>
        )}
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
