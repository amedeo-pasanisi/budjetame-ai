/** The Verification row editor (issue #46): any Preview row — ready,
 * duplicate, or problem — opens this modal prefilled with its fields. It
 * reuses the Transaction form's shape (type picker, amount/date
 * grid, the wallet/category vs source/destination cascade, description,
 * location) but edits *names*, not the Transaction form's resolved entities:
 * the row's Wallet and Category are names that the re-validation endpoint
 * resolves server-side. Saving sends the edited fields and closes —
 * the row's status flips inline in the list behind. The shell's dismissal
 * paths (backdrop tap, Escape, Cancel) abandon the edit without changing the
 * row.
 *
 * The Wallet and Category fields are entity selects with the inline "＋
 * Add…" sentinel (issue #77, ADR-0013): each lists the Account's existing
 * entities of the kind the row can use — non-Contact active Wallets for an
 * Expense/Income's Wallet field, all active Wallets for a Transfer's From/To,
 * Categories of the row's type — with the file's name kept as a "doesn't
 * exist yet" option when it matches nothing. Picking the sentinel opens the
 * entity's create modal (hosted by the screen, like the Transaction form's)
 * prefilled with that name; submitting creates the entity for real
 * (ADR-0014) and auto-selects it here, leaving the rest of the draft
 * untouched. */
import { useEffect, useState, type FormEvent } from 'react'

import type { Category, ImportRow, ImportRowInput, Wallet } from './api'
import { ImportEntitySelect } from './ImportEntitySelect'
import { ModalShell } from './ModalShell'
import { NON_CONTACT_WALLET_TYPES } from './transactions'
import {
  TypeSelector,
  type TransactionFormType,
  type WalletTarget,
} from './transactionFields'

type ImportRowModalProps = {
  row: ImportRow
  /** The Account's Wallets (active and frozen — the screen passes the full
   * list): the selects offer only active ones, since the import rejects
   * frozen Wallets, and the Expense/Income Wallet select only the three
   * non-Contact types, since Contact Wallets move money only via
   * Transfers. */
  wallets: Wallet[]
  /** The Account's Categories; the Category select offers the row's type
   * only, exactly like the validation resolves them. */
  categories: Category[]
  /** Re-validate the edited row (issue #44) and flip its status in the
   * draft. Resolving with anything closes the modal; rejecting keeps it open
   * with the failure inline. */
  onSave: (input: ImportRowInput) => Promise<void>
  onClose: () => void
  /** Inline entity creation (ADR-0013): opens the Wallet create modal,
   * hosted by the screen, prefilled with the field's current name when it
   * does not resolve (the missing name from the file). The target is the
   * field whose sentinel was picked — 'wallet' for an Expense/Income,
   * 'source'/'destination' for a Transfer's From/To — and drives the
   * modal's eligibility lock. */
  onAddWallet: (target: WalletTarget, prefillName: string) => void
  /** The freshly created Wallet the screen reports back, with the field
   * whose sentinel was picked: that exact field selects it (by name),
   * leaving the rest of the draft untouched. */
  walletToSelect: { name: string; target: WalletTarget } | null
  /** Inline entity creation (ADR-0013): opens the Category create modal,
   * hosted by the screen, locked to the row's current type and prefilled
   * with the field's missing name. */
  onAddCategory: (type: 'expense' | 'income', prefillName: string) => void
  /** The freshly created Category the screen reports back: the field
   * selects it (by name), leaving the rest of the draft untouched. */
  categoryToSelect: string | null
}

export function ImportRowModal({
  row,
  wallets,
  categories,
  onSave,
  onClose,
  onAddWallet,
  walletToSelect,
  onAddCategory,
  categoryToSelect,
}: ImportRowModalProps) {
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
  // The Category select's type while the row is an Expense or Income (the
  // Transfer branch renders no Category field at all).
  const categoryType: 'expense' | 'income' = type === 'transfer' ? 'expense' : type
  // Frozen Wallets never resolve for an import (the validation rejects
  // them), so the selects offer only active ones.
  const activeWallets = wallets.filter((wallet) => !wallet.frozen)
  // An Expense/Income's Wallet select: Contact Wallets only move money via
  // Transfers, so they never appear here.
  const spendableWallets = activeWallets.filter((wallet) =>
    NON_CONTACT_WALLET_TYPES.includes(wallet.type),
  )
  const matchingCategories = categories.filter((c) => c.type === categoryType)
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

  // Inline entity creation (ADR-0013): when the screen's inner Wallet modal
  // saves, it reports the new Wallet's name here so the exact field whose
  // sentinel was picked selects it — and nothing else in the draft moves.
  useEffect(() => {
    if (walletToSelect === null) return
    if (walletToSelect.target === 'source') {
      setSourceWallet(walletToSelect.name)
    } else if (walletToSelect.target === 'destination') {
      setDestinationWallet(walletToSelect.name)
    } else {
      setWallet(walletToSelect.name)
    }
  }, [walletToSelect])
  // The Category field's inline creation, same contract: the new Category's
  // name lands in the Category field, the only field that changes.
  useEffect(() => {
    if (categoryToSelect !== null) {
      setCategory(categoryToSelect)
    }
  }, [categoryToSelect])

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
            <ImportEntitySelect
              id="im-source"
              label="From"
              required
              value={sourceWallet}
              onChange={setSourceWallet}
              options={activeWallets.map((w) => ({ name: w.name, label: w.name }))}
              entity="wallet"
              onAdd={(prefillName) => onAddWallet('source', prefillName)}
            />
            <ImportEntitySelect
              id="im-destination"
              label="To"
              required
              value={destinationWallet}
              onChange={setDestinationWallet}
              options={activeWallets.map((w) => ({ name: w.name, label: w.name }))}
              entity="wallet"
              onAdd={(prefillName) => onAddWallet('destination', prefillName)}
            />
          </div>
        ) : (
          <div>
            <ImportEntitySelect
              id="im-wallet"
              label="Wallet"
              required
              value={wallet}
              onChange={setWallet}
              options={spendableWallets.map((w) => ({ name: w.name, label: w.name }))}
              entity="wallet"
              onAdd={(prefillName) => onAddWallet('wallet', prefillName)}
            />
            <p className="mt-1 text-xs text-slate-500">
              Contact wallets only move money through transfers.
            </p>
          </div>
        )}

        {isTransfer ? (
          <p className="text-xs text-slate-500">Transfers never carry a category.</p>
        ) : (
          <ImportEntitySelect
            id="im-category"
            label="Category"
            value={category}
            onChange={setCategory}
            options={matchingCategories.map((c) => ({
              name: c.name,
              label: c.icon !== null ? `${c.icon} ${c.name}` : c.name,
            }))}
            entity="category"
            onAdd={(prefillName) => onAddCategory(categoryType, prefillName)}
          />
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
