/** The Verification row editor (issue #46): any Preview row — ready,
 * duplicate, or problem — opens this modal prefilled with its fields. It
 * reuses the Transaction form's shape (type picker, amount/date
 * grid, the wallet/category vs source/destination cascade, description,
 * location) but edits *names*, not the Transaction form's resolved entities:
 * the row's Wallet and Category are free text that the re-validation
 * endpoint resolves server-side. Saving sends the edited fields and closes —
 * the row's status flips inline in the list behind. The shell's dismissal
 * paths (backdrop tap, Escape, Cancel) abandon the edit without changing the
 * row. */
import { useState, type FormEvent } from 'react'

import type { ImportRow, ImportRowInput } from './api'
import { ModalShell } from './ModalShell'
import { TypeSelector, type TransactionFormType } from './transactionFields'

type ImportRowModalProps = {
  row: ImportRow
  /** Re-validate the edited row (issue #44) and flip its status in the
   * draft. Resolving with anything closes the modal; rejecting keeps it open
   * with the failure inline. */
  onSave: (input: ImportRowInput) => Promise<void>
  onClose: () => void
}

export function ImportRowModal({ row, onSave, onClose }: ImportRowModalProps) {
  const rowType: TransactionFormType =
    row.type === 'transfer' || row.type === 'income' ? row.type : 'expense'
  const [type, setType] = useState<TransactionFormType>(rowType)
  const [amount, setAmount] = useState(row.amount ?? '')
  const [date, setDate] = useState(row.date ?? '')
  const [wallet, setWallet] = useState(row.wallet ?? '')
  const [sourceWallet, setSourceWallet] = useState(row.source_wallet ?? '')
  const [destinationWallet, setDestinationWallet] = useState(row.destination_wallet ?? '')
  const [category, setCategory] = useState(row.category ?? '')
  const [description, setDescription] = useState(row.description ?? '')
  const [latitude, setLatitude] = useState(row.latitude ?? '')
  const [longitude, setLongitude] = useState(row.longitude ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isTransfer = type === 'transfer'
  const amountValue = Number.parseFloat(amount)
  const hasAmount = !Number.isNaN(amountValue) && amountValue > 0
  // Blank fields travel as null, like the Preview's resolution does.
  const cleaned = (value: string) => (value.trim() === '' ? null : value.trim())
  const canSave =
    !submitting &&
    hasAmount &&
    date !== '' &&
    (isTransfer
      ? cleaned(sourceWallet) !== null &&
        cleaned(destinationWallet) !== null &&
        cleaned(sourceWallet) !== cleaned(destinationWallet)
      : cleaned(wallet) !== null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSave({
        row: row.row,
        type,
        date,
        amount,
        wallet: isTransfer ? null : cleaned(wallet),
        source_wallet: isTransfer ? cleaned(sourceWallet) : null,
        destination_wallet: isTransfer ? cleaned(destinationWallet) : null,
        category: isTransfer ? null : cleaned(category),
        description: cleaned(description),
        latitude: cleaned(latitude),
        longitude: cleaned(longitude),
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell label={`Edit row ${row.row}`} onClose={onClose}>
      <form
        onSubmit={handleSubmit}
        className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h3 className="font-medium text-slate-900">Edit row {row.row}</h3>

        <TypeSelector active={type} disabled={false} onSelect={setType} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="im-amount" className="block text-sm font-medium text-slate-700">
              Amount (€)
            </label>
            <input
              id="im-amount"
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
            <label htmlFor="im-date" className="block text-sm font-medium text-slate-700">
              Date
            </label>
            <input
              id="im-date"
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
            <div>
              <label htmlFor="im-source" className="block text-sm font-medium text-slate-700">
                From
              </label>
              <input
                id="im-source"
                type="text"
                required
                maxLength={80}
                value={sourceWallet}
                onChange={(event) => setSourceWallet(event.target.value)}
                placeholder="e.g. Bank"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="im-destination"
                className="block text-sm font-medium text-slate-700"
              >
                To
              </label>
              <input
                id="im-destination"
                type="text"
                required
                maxLength={80}
                value={destinationWallet}
                onChange={(event) => setDestinationWallet(event.target.value)}
                placeholder="e.g. Cash"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="im-wallet" className="block text-sm font-medium text-slate-700">
              Wallet
            </label>
            <input
              id="im-wallet"
              type="text"
              required
              maxLength={80}
              value={wallet}
              onChange={(event) => setWallet(event.target.value)}
              placeholder="e.g. Cash"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        )}

        {isTransfer ? (
          <p className="text-xs text-slate-500">Transfers never carry a category.</p>
        ) : (
          <div>
            <label htmlFor="im-category" className="block text-sm font-medium text-slate-700">
              Category
            </label>
            <input
              id="im-category"
              type="text"
              maxLength={80}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        )}

        <div>
          <label htmlFor="im-description" className="block text-sm font-medium text-slate-700">
            Description
          </label>
          <input
            id="im-description"
            type="text"
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional note"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="im-latitude" className="block text-sm font-medium text-slate-700">
              Latitude
            </label>
            <input
              id="im-latitude"
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="im-longitude" className="block text-sm font-medium text-slate-700">
              Longitude
            </label>
            <input
              id="im-longitude"
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="Optional"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {error !== null && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
