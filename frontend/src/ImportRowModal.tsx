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
 * Returns i18n message IDs keyed by field — the form translates them
 * through `formatMessage` before passing to FieldError. Runs on every
 * Save click before any API call; a form with errors submits nothing.
 * Reuses the shared tolerant amount parser from the validation layer (issue
 * #102). Wallet presence is the name's non-blankness — the import
 * re-resolves names server-side — and a Transfer's From/To must name
 * different Wallets. */
function validate(draft: ImportRowDraft): FieldErrors {
  const errors: FieldErrors = {}
  const trimmedAmount = draft.amount.trim()
  if (trimmedAmount === '') {
    errors.amount = 'importRowModal.validation.amountEmpty'
  } else if (parseAmount(trimmedAmount) === null) {
    errors.amount = /^-?\d+([.,]\d+)?$/.test(trimmedAmount)
      ? 'importRowModal.validation.amountNotPositive'
      : 'importRowModal.validation.amountInvalid'
  }
  if (draft.date.trim() === '') {
    errors.date = 'importRowModal.validation.dateEmpty'
  }
  if (draft.type === 'transfer') {
    if (draft.sourceWallet.trim() === '') {
      errors.source = 'importRowModal.validation.sourceRequired'
    }
    if (draft.destinationWallet.trim() === '') {
      errors.destination = 'importRowModal.validation.destinationRequired'
    }
    if (
      draft.sourceWallet.trim() !== '' &&
      draft.sourceWallet.trim() === draft.destinationWallet.trim()
    ) {
      errors.source = 'importRowModal.validation.sameWallet'
      errors.destination = 'importRowModal.validation.sameWallet'
    }
  } else {
    if (draft.wallet.trim() === '') {
      errors.wallet = 'importRowModal.validation.walletRequired'
    }
  }
  return errors
}

/** Translate FieldErrors from i18n message IDs to human-readable strings. */
function translateErrors(errors: FieldErrors, formatMessage: (descriptor: { id: string }) => string): FieldErrors {
  const translated: FieldErrors = {}
  for (const [field, key] of Object.entries(errors)) {
    translated[field] = formatMessage({ id: key })
  }
  return translated
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
import { useIntl } from 'react-intl'

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
  wallets: Wallet[]
  categories: Category[]
  onSave: (input: ImportRowInput) => Promise<void>
  onClose: () => void
  onAddWallet: (target: WalletTarget, prefillName: string) => void
  walletToSelect: { name: string; target: WalletTarget } | null
  onAddCategory: (type: 'expense' | 'income', prefillName: string) => void
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
  const { formatMessage } = useIntl()
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
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const isTransfer = type === 'transfer'
  const categoryType: 'expense' | 'income' = type === 'transfer' ? 'expense' : type
  const activeWallets = wallets.filter((wallet) => !wallet.frozen)
  const spendableWallets = activeWallets.filter((wallet) =>
    NON_CONTACT_WALLET_TYPES.includes(wallet.type),
  )
  const matchingCategories = categories.filter((c) => c.type === categoryType)
  const cleaned = (value: string) => (value.trim() === '' ? null : value.trim())

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
  useEffect(() => {
    if (categoryToSelect !== null) {
      setCategory(categoryToSelect)
    }
  }, [categoryToSelect])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fieldErrors = validate({
      type,
      amount,
      date,
      wallet,
      sourceWallet,
      destinationWallet,
    })
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(translateErrors(fieldErrors, formatMessage))
      return
    }
    setErrors({})
    setSubmitting(true)
    setError(null)
    try {
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
      setError(cause instanceof Error ? cause.message : formatMessage({ id: 'importRowModal.error.generic' }))
      setSubmitting(false)
    }
  }

  return (
    <ModalShell label={formatMessage({ id: 'importRowModal.edit' }, { row: row.row })} onClose={onClose}>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h3 className="font-medium text-slate-900">{formatMessage({ id: 'importRowModal.edit' }, { row: row.row })}</h3>

        <TypeSelector active={type} disabled={false} onSelect={setType} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="im-amount" className="block text-sm font-medium text-slate-700">
              {formatMessage({ id: 'importRowModal.amount' })}
            </label>
            <input
              id="im-amount"
              type="text"
              inputMode="decimal"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder={formatMessage({ id: 'importRowModal.amountPlaceholder' })}
              {...fieldErrorProps('amount', errors)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
            <FieldError field="amount" errors={errors} />
          </div>
          <div>
            <label htmlFor="im-date" className="block text-sm font-medium text-slate-700">
              {formatMessage({ id: 'importRowModal.date' })}
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
                label={formatMessage({ id: 'importRowModal.from' })}
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
                label={formatMessage({ id: 'importRowModal.to' })}
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
              label={formatMessage({ id: 'importRowModal.wallet' })}
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
              {formatMessage({ id: 'importRowModal.contactExplanation' })}
            </p>
          </div>
        )}

        {isTransfer ? (
          <p className="text-xs text-slate-500">{formatMessage({ id: 'importRowModal.noCategory' })}</p>
        ) : (
          <ImportEntitySelect
            id="im-category"
            label={formatMessage({ id: 'importRowModal.category' })}
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
            {formatMessage({ id: 'importRowModal.description' })}
          </label>
          <input
            id="im-description"
            type="text"
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={formatMessage({ id: 'importRowModal.descriptionPlaceholder' })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="im-latitude" className="block text-sm font-medium text-slate-700">
              {formatMessage({ id: 'importRowModal.latitude' })}
            </label>
            <input
              id="im-latitude"
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder={formatMessage({ id: 'importRowModal.latPlaceholder' })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="im-longitude" className="block text-sm font-medium text-slate-700">
              {formatMessage({ id: 'importRowModal.longitude' })}
            </label>
            <input
              id="im-longitude"
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder={formatMessage({ id: 'importRowModal.lonPlaceholder' })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {error !== null && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {submitting ? formatMessage({ id: 'importRowModal.saving' }) : formatMessage({ id: 'importRowModal.save' })}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
          >
            {formatMessage({ id: 'importRowModal.cancel' })}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}