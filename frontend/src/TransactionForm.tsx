import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type Category,
  type Transaction,
  type TransactionInput,
  type Wallet,
} from './api'
import {
  CategoryField,
  TransferBalancePreview,
  TransferWalletFields,
  TypeSelector,
  WalletBalancePreview,
  WalletField,
  type TransactionFormType,
} from './transactionFields'
import { MapPicker } from './MapPicker'
import { projectBalance, projectTransfer } from './balanceProjection'
import {
  formatLocation,
  getGpsPosition,
  gpsPrefillAvailable,
  latLngFromWire,
  latLngToWire,
  locationOptOutActive,
  mapLink,
  markGpsGranted,
  markLocationOptOut,
  type LatLng,
} from './location'
import { NON_CONTACT_WALLET_TYPES, todayInRome } from './transactions'

type TransactionFormProps = {
  wallets: Wallet[]
  categories: Category[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: (warning: boolean) => void
  onCancel: () => void
}

/** The create/edit/delete form for a Transaction (Expense, Income, or
 * Transfer), hosted in the modal shell (TransactionModal) by the
 * Transactions tab. Cancel — like the shell's backdrop and Escape —
 * abandons the draft without saving. */
export function TransactionForm({
  wallets,
  categories,
  editing,
  onSaved,
  onDeleted,
  onCancel,
}: TransactionFormProps) {
  const [type, setType] = useState<TransactionFormType>(
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
  // Seeded from the session flag (issue #25) so the opt-out survives the tab
  // switch that unmounts the form; manual add paths never consult it.
  const [locationOptedOut, setLocationOptedOut] = useState(() => locationOptOutActive())
  // Set once the user changes the location themselves, so a pending GPS prefill
  // cannot overwrite an explicit choice.
  const locationTouched = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isEditing = editing !== null
  const isTransfer = type === 'transfer'

  const sourceWallet = wallets.find((w) => w.id === sourceWalletId)
  const destinationWallet = wallets.find((w) => w.id === destinationWalletId)
  const selectedWallet = wallets.find((w) => w.id === walletId)
  const amountValue = Number.parseFloat(amount)
  const hasAmount = !Number.isNaN(amountValue) && amountValue > 0
  // The Wallet's current Balance includes the Transaction being edited, so the
  // projection removes its old contribution before adding the new amount
  // (issue #24); null when creating. Safe because Wallet and type are locked
  // while editing.
  const editedAmount = isEditing && editing !== null ? editing.amount : null

  const singleWalletProjection = useMemo(() => {
    if (type === 'transfer' || selectedWallet === undefined || !hasAmount) return null
    return projectBalance({
      currentBalance: selectedWallet.balance,
      type,
      newAmount: amountValue,
      editedAmount,
    })
  }, [type, selectedWallet, hasAmount, amountValue, editedAmount])

  const transferProjection = useMemo(() => {
    if (
      type !== 'transfer' ||
      sourceWallet === undefined ||
      destinationWallet === undefined ||
      !hasAmount
    ) {
      return null
    }
    return projectTransfer({
      sourceBalance: sourceWallet.balance,
      destinationBalance: destinationWallet.balance,
      newAmount: amountValue,
      editedAmount,
    })
  }, [type, sourceWallet, destinationWallet, hasAmount, amountValue, editedAmount])

  const cashAfter = isTransfer
    ? (transferProjection?.source.after ?? null)
    : (singleWalletProjection?.after ?? null)
  const willWarn =
    (isTransfer ? sourceWallet?.type === 'cash' : selectedWallet?.type === 'cash') &&
    cashAfter !== null &&
    cashAfter < 0

  // GPS prefill (US18 / T9): when creating a Transaction and device-location
  // permission is already granted, pre-fill the location from the current
  // position so recording takes one tap. The browser never prompts here — it
  // only prompts on the first save (below). A user-chosen or user-removed
  // location is never overwritten by a pending prefill.
  useEffect(() => {
    if (isEditing || locationOptedOut) {
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
  }, [isEditing, locationOptedOut])

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
      const result = await deleteTransaction(token, editing.id)
      onDeleted(result.warning)
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

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="font-medium text-slate-900">
        {isEditing ? 'Edit transaction' : 'New transaction'}
      </h3>

      <TypeSelector active={type} disabled={isEditing} onSelect={setType} />

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
        <TransferWalletFields
          wallets={wallets}
          sourceWalletId={sourceWalletId}
          destinationWalletId={destinationWalletId}
          disabled={isEditing}
          onSourceChange={setSourceWalletId}
          onDestinationChange={setDestinationWalletId}
        />
      ) : (
        <WalletField wallets={wallets} value={walletId} disabled={isEditing} onChange={setWalletId} />
      )}

      {isTransfer ? (
        sourceWallet !== undefined &&
        destinationWallet !== undefined &&
        transferProjection !== null ? (
          <TransferBalancePreview
            source={sourceWallet}
            destination={destinationWallet}
            projection={transferProjection}
            willWarn={willWarn}
          />
        ) : null
      ) : selectedWallet !== undefined && singleWalletProjection !== null ? (
        <WalletBalancePreview
          wallet={selectedWallet}
          before={singleWalletProjection.before}
          after={singleWalletProjection.after}
          willWarn={willWarn}
        />
      ) : null}

      {isTransfer ? (
        <p className="text-xs text-slate-500">Transfers never carry a category.</p>
      ) : (
        <CategoryField
          categories={categories}
          type={type}
          value={categoryId}
          onChange={setCategoryId}
        />
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
                // The opt-out is a create-form decision (issue #25): removing
                // a location on a new Transaction disables the GPS prefill
                // for the session; editing is unaffected.
                if (!isEditing) {
                  markLocationOptOut()
                }
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
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
        >
          Cancel
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
