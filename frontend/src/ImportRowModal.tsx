/** The row editor's draft, as submit-and-validate (ADR-0029) sees it:
 * everything that can be wrong, in one flat record, so the pure
 * `validate()` below can judge it without touching React. */
type ImportRowDraft = {
  type: TransactionFormType
  amount: string
  date: string
  wallet: string
  sourceWallet: string
  destinationWallet: string
}

/** Submit-and-validate (ADR-0029): the row editor's pure validation.
 * Returns one Field Error per wrong field — keyed by the error keys the
 * fields render under — and nothing for a valid form. Runs on every Save
 * click before any API call; a form with errors submits nothing. Reuses
 * the shared tolerant amount parser from the validation layer (issue
 * #102), never re-implementing it: an empty Amount is its own message, an
 * unparseable one (letters, signs, malformed groupings) another, and a
 * parseable-but-non-positive one a third. Wallet presence is the name's
 * non-blankness — the import re-resolves names server-side — and a
 * Transfer's From/To must name different Wallets. */
function validate(draft: ImportRowDraft): FieldErrors {
  const errors: FieldErrors = {}
  const trimmedAmount = draft.amount.trim()
  if (trimmedAmount === '') {
    errors.amount = 'Enter an amount'
  } else if (parseAmount(trimmedAmount) === null) {
    // parseAmount reads a finite positive number, or null for everything
    // else. Split the nulls the way users experience them: text that is
    // not an amount at all, vs a number that just is not positive.
    errors.amount = /^-?\d+([.,]\d+)?$/.test(trimmedAmount)
      ? 'Amount must be a positive number'
      : "That doesn't look like an amount — use digits and one . or , for decimals"
  }
  if (draft.date.trim() === '') {
    errors.date = 'Choose a date'
  }
  if (draft.type === 'transfer') {
    if (draft.sourceWallet.trim() === '') {
      errors.source = 'Choose the source wallet.'
    }
    if (draft.destinationWallet.trim() === '') {
      errors.destination = 'Choose the destination wallet.'
    }
    if (
      draft.sourceWallet.trim() !== '' &&
      draft.sourceWallet.trim() === draft.destinationWallet.trim()
    ) {
      // Both legs are equally wrong: the same message rides under each.
      errors.source = 'Source and destination must be different wallets.'
      errors.destination = 'Source and destination must be different wallets.'
    }
  } else {
    if (draft.wallet.trim() === '') {
      errors.wallet = 'Choose a wallet.'
    }
  }
  return errors
}

/** The Verification row editor (issue #46): any Preview row — ready,
 * duplicate, or problem — opens this modal prefilled with its fields. It
 * reuses the Transaction form's shape (type picker, amount/date
 * grid, the wallet/category vs source/destination cascade, description,
 * location) but edits *names*, not the Transaction form's resolved entities:
 * the row's Wallet and Category are names that the re-validation endpoint
 * resolves server-side. Saving validates the draft client-side first
 * (ADR-0029) — an invalid row reveals Field Errors inline and submits
 * nothing — then sends the edited fields and closes; the row's status
 * flips inline in the list behind. The shell's dismissal
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
import { FieldError } from './FieldError'
import { ImportEntitySelect } from './ImportEntitySelect'
import { ModalShell } from './ModalShell'
import { NON_CONTACT_WALLET_TYPES } from './transactions'
import {
  TypeSelector,
  type TransactionFormType,
  type WalletTarget,
} from './transactionFields'
import { fieldErrorProps, parseAmount, type FieldErrors } from './validation'

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
  // Field Errors (ADR-0029): revealed by a Save attempt, they persist
  // while the user types and refresh only on the next Save click — never
  // live, never on blur.
  const [errors, setErrors] = useState<FieldErrors>({})
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
  // Blank fields travel as null, like the Preview's resolution does.
  const cleaned = (value: string) => (value.trim() === '' ? null : value.trim())

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
    // Submit-and-validate (ADR-0029): judge the draft first. Any Field
    // Error reveals inline under its field, and the submit ends here —
    // nothing reaches the API. A valid draft clears the errors (they
    // refresh only on this next Save attempt) and proceeds exactly as
    // before.
    const fieldErrors = validate({
      type,
      amount,
      date,
      wallet,
      sourceWallet,
      destinationWallet,
    })
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    setError(null)
    try {
      // The tolerant Amount Input (ADR-0029) sends the canonical cents
      // value — "17,5" and "1.000,45" reach the re-validation endpoint as
      // "17.50" and "1000.45" — the backend's Decimal would reject the
      // separators. Null is impossible here: the validation above already
      // proved the draft parses.
      const canonicalAmount = (parseAmount(amount) ?? 0).toFixed(2)
      await onSave({
        row: row.row,
        type,
        date,
        amount: canonicalAmount,
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
      {/* noValidate (ADR-0029): the browser's native bubbles never appear;
      the Field Errors are the only validation voice. */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h3 className="font-medium text-slate-900">Edit row {row.row}</h3>

        <TypeSelector active={type} disabled={false} onSelect={setType} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="im-amount" className="block text-sm font-medium text-slate-700">
              Amount (€)
            </label>
            {/* The browser-owned type="number" is what swallowed "17.5" in
            comma-locales (ADR-0029): parsing is ours now — a tolerant text
            field read by parseAmount, with the Error's aria wiring. */}
            <input
              id="im-amount"
              type="text"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              {...fieldErrorProps('amount', errors)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
            <FieldError field="amount" errors={errors} />
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
              {...fieldErrorProps('date', errors)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <FieldError field="date" errors={errors} />
          </div>
        </div>

        {isTransfer ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <ImportEntitySelect
                id="im-source"
                label="From"
                required
                value={sourceWallet}
                onChange={setSourceWallet}
                options={activeWallets.map((w) => ({ name: w.name, label: w.name }))}
                entity="wallet"
                onAdd={(prefillName) => onAddWallet('source', prefillName)}
                errorProps={fieldErrorProps('source', errors)}
              />
              <FieldError field="source" errors={errors} />
            </div>
            <div>
              <ImportEntitySelect
                id="im-destination"
                label="To"
                required
                value={destinationWallet}
                onChange={setDestinationWallet}
                options={activeWallets.map((w) => ({ name: w.name, label: w.name }))}
                entity="wallet"
                onAdd={(prefillName) => onAddWallet('destination', prefillName)}
                errorProps={fieldErrorProps('destination', errors)}
              />
              <FieldError field="destination" errors={errors} />
            </div>
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
              errorProps={fieldErrorProps('wallet', errors)}
            />
            <FieldError field="wallet" errors={errors} />
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
          {/* Submit-and-validate (ADR-0029): disabled only while the
          re-validation request is actually in flight — never because the
          draft is invalid. An invalid draft reveals Field Errors instead
          of a dead button. */}
          <button
            type="submit"
            disabled={submitting}
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
