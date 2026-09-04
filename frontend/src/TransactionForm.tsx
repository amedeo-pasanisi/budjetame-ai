import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type Category,
  type RecurringCost,
  type RecurringIncome,
  type Transaction,
  type TransactionInput,
  type Wallet,
} from './api'
import {
  CategoryField,
  RecurringCostField,
  RecurringIncomeField,
  TransferBalancePreview,
  TransferWalletFields,
  TypeSelector,
  WalletBalancePreview,
  WalletField,
  type TransactionFormType,
  type WalletTarget,
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
  placeFromWire,
  placeToWire,
  type LatLng,
  type Place,
} from './location'
import { NON_CONTACT_WALLET_TYPES, todayInRome } from './transactions'

type TransactionFormProps = {
  wallets: Wallet[]
  categories: Category[]
  recurringCosts: RecurringCost[]
  recurringIncomes: RecurringIncome[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: (warning: boolean) => void
  onCancel: () => void
  /** Inline entity creation (ADR-0013): opens the Category create modal
   * hosted by the screen, locked to the transaction's current type —
   * Expense for an Expense, Income for an Income. The Transfer form has no
   * Category field, so it never calls this. */
  onAddCategory: (type: 'expense' | 'income') => void
  /** The freshly created Category the screen reports back: the field selects
   * it, leaving the rest of the draft untouched. */
  categoryToSelect: number | null
  /** Inline entity creation (ADR-0013): opens the Wallet create modal
   * hosted by the screen — all four types (including Contact) for an
   * Expense's Wallet field and a Transfer's From/To, Checking/Credit
   * Card/Cash only for an Income's Wallet field (ADR-0017). The form
   * reports its current type so the screen can restrict the modal
   * accordingly. */
  onAddWallet: (target: WalletTarget, type: TransactionFormType) => void
  /** The freshly created Wallet the screen reports back, with the field
   * whose sentinel was picked: that exact field selects it, leaving the
   * rest of the draft untouched. */
  walletToSelect: { id: number; target: WalletTarget } | null
  /** Inline entity creation (ADR-0013): opens the Recurring Cost create
   * modal hosted by the screen, stacked on top of this one — the Recurring
   * Cost field's sentinel (an Expense, or a Transfer to a Contact Wallet,
   * ADR-0027). */
  onAddRecurringCost: () => void
  /** The freshly created Recurring Cost the screen reports back: the field
   * selects it — which per the linking contract immediately pays the new
   * definition's oldest Unpaid Occurrence — leaving the rest of the draft
   * untouched. */
  recurringCostToSelect: number | null
  /** Inline entity creation (ADR-0013): opens the Recurring Income create
   * modal hosted by the screen, stacked on top of this one — the Recurring
   * Income field's sentinel (an Income, or a Transfer from a Contact
   * Wallet, ADR-0027). */
  onAddRecurringIncome: () => void
  /** The freshly created Recurring Income the screen reports back, mirror
   * of the cost contract: the field selects it, paying the new
   * definition's oldest Unpaid Occurrence. */
  recurringIncomeToSelect: number | null
}

/** The create/edit/delete form for a Transaction (Expense, Income, or
 * Transfer), hosted in the modal shell (TransactionModal) by the
 * Transactions tab. Cancel — like the shell's backdrop and Escape —
 * abandons the draft without saving. */
export function TransactionForm({
  wallets,
  categories,
  recurringCosts,
  recurringIncomes,
  editing,
  onSaved,
  onDeleted,
  onCancel,
  onAddCategory,
  categoryToSelect,
  onAddWallet,
  walletToSelect,
  onAddRecurringCost,
  recurringCostToSelect,
  onAddRecurringIncome,
  recurringIncomeToSelect,
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
  // Frozen Wallets are read-only (ADR-0002): they can never receive a new
  // Transaction, so the form only offers active Wallets in its pickers and
  // seeds its defaults from them. The screen passes the full list
  // (include_frozen) because the ledger filter needs it.
  const assignableWallets = wallets.filter((wallet) => !wallet.frozen)
  // The default Wallet for an Expense/Income: the first spendable one. A
  // Contact Wallet never defaults — an Expense on one is a deliberate pick
  // (ADR-0017), and Incomes cannot use one at all. Shared by the seed and
  // the Expense→Income reset below, so the two can never drift.
  const spendableWallets = useMemo(
    () => assignableWallets.filter((w) => NON_CONTACT_WALLET_TYPES.includes(w.type)),
    [assignableWallets],
  )
  const firstSpendableWalletId = spendableWallets[0]?.id
  const [walletId, setWalletId] = useState<number | undefined>(
    editing?.type === 'transfer'
      ? undefined
      : (editing?.wallet_id ?? firstSpendableWalletId),
  )
  // The Wallet picker's allowed types depend on the form type (ADR-0017):
  // Expenses may record consumption a Contact paid for, Incomes may not.
  // Switching an Expense that picked a Contact Wallet to Income must not
  // ride the stale Contact selection along to the API (where the backend
  // would reject it) — reset to the first spendable Wallet, like the
  // initial seed.
  useEffect(() => {
    if (type !== 'income') return
    const selected = wallets.find((w) => w.id === walletId)
    if (selected !== undefined && selected.type === 'contact') {
      setWalletId(firstSpendableWalletId)
    }
  }, [type, walletId, wallets, firstSpendableWalletId])
  const [sourceWalletId, setSourceWalletId] = useState<number | undefined>(
    editing?.type === 'transfer' ? (editing.source_wallet_id ?? undefined) : assignableWallets[0]?.id,
  )
  const [destinationWalletId, setDestinationWalletId] = useState<number | undefined>(
    editing?.type === 'transfer'
      ? (editing.destination_wallet_id ?? undefined)
      : (assignableWallets[1]?.id ?? assignableWallets[0]?.id),
  )
  const [categoryId, setCategoryId] = useState<number | null>(editing?.category_id ?? null)

  // Inline entity creation (ADR-0013): when the screen's inner Category
  // modal saves, it reports the new Category's id here so this field
  // selects it — the only field that changes, the rest of the draft stays.
  useEffect(() => {
    if (categoryToSelect !== null) {
      setCategoryId(categoryToSelect)
    }
  }, [categoryToSelect])
  // The Wallet field's inline creation, same contract — but a Transfer has
  // two Wallet fields, so the screen reports the target too: the new
  // Wallet's id lands in exactly the field whose sentinel was picked
  // ('wallet' for an Expense/Income, 'source' or 'destination' for a
  // Transfer), and nothing else in the draft moves.
  useEffect(() => {
    if (walletToSelect === null) return
    if (walletToSelect.target === 'source') {
      setSourceWalletId(walletToSelect.id)
    } else if (walletToSelect.target === 'destination') {
      setDestinationWalletId(walletToSelect.id)
    } else {
      setWalletId(walletToSelect.id)
    }
  }, [walletToSelect])
  // The optional Recurring Cost link (issue #57, ADR-0027): an Expense —
  // or a Transfer to a Contact Wallet — pins one cost, paying its oldest
  // Unpaid Occurrence. Seeded from the Transaction being edited, so an
  // untouched link is never re-sent (and never re-pinned).
  const [recurringCostId, setRecurringCostId] = useState<number | null>(
    editing?.recurring_cost_id ?? null,
  )
  // Inline entity creation (ADR-0013): when the screen's inner Recurring
  // Cost modal saves, it reports the new definition's id here so this field
  // selects it — which per the linking contract immediately pays the new
  // cost's oldest Unpaid Occurrence (due today for a fresh definition with
  // no start date), the helper naming it. The only field that changes, the
  // rest of the draft stays.
  useEffect(() => {
    if (recurringCostToSelect !== null) {
      setRecurringCostId(recurringCostToSelect)
    }
  }, [recurringCostToSelect])
  // The optional Recurring Income link (issue #61, ADR-0027), mirroring
  // the cost link: an Income — or a Transfer from a Contact Wallet — pins
  // one Recurring Income, paying its oldest Unpaid Occurrence. Same
  // seed-from-editing contract.
  const [recurringIncomeId, setRecurringIncomeId] = useState<number | null>(
    editing?.recurring_income_id ?? null,
  )
  // The Recurring Income field's inline creation, the mirror of the cost
  // one above: the new definition's id arrives from the screen and takes
  // the field, paying its oldest Unpaid Occurrence.
  useEffect(() => {
    if (recurringIncomeToSelect !== null) {
      setRecurringIncomeId(recurringIncomeToSelect)
    }
  }, [recurringIncomeToSelect])
  const [description, setDescription] = useState(editing?.description ?? '')
  const descriptionField = useRef<HTMLTextAreaElement | null>(null)
  // Auto-grow (issue #53): rows follow the explicit line count so the field
  // always holds every line; the measured-height effect below absorbs soft
  // wraps (one long line folding over the field width), which line counts
  // cannot see and jsdom cannot lay out.
  const descriptionRows = Math.max(2, description.split('\n').length)
  useLayoutEffect(() => {
    const el = descriptionField.current
    if (el === null) return
    el.style.height = 'auto'
    const contentHeight = el.scrollHeight
    if (contentHeight > 0) {
      el.style.height = `${contentHeight}px`
    }
  }, [description])
  const [location, setLocation] = useState<LatLng | null>(() =>
    latLngFromWire(editing?.latitude ?? null, editing?.longitude ?? null),
  )
  // The optional Place reference (ADR-0005): set by a pick that carries one
  // (search pick, Google-map tap), cleared by a coordinates-only pick
  // (Leaflet tap, GPS), or Remove. It always accompanies coordinates — never
  // the reverse.
  const [place, setPlace] = useState<Place | null>(() =>
    placeFromWire(editing?.place_name ?? null, editing?.place_id ?? null),
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
  // GPS feedback (issue #35): true while the "Use my location" lookup runs,
  // so the button can disable and show "Locating…" instead of failing silently.
  const [locating, setLocating] = useState(false)
  // Inline failure message for the GPS lookup (denied, timeout, unavailable),
  // cleared by a successful GPS pick, a map pick, or a Remove.
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isEditing = editing !== null
  const isTransfer = type === 'transfer'

  // The Occurrence the picker says the link will pay (issue #57): for a new
  // link it is the selected cost's oldest Unpaid Occurrence (from the API);
  // for the very link already on the edited Transaction it is the stored
  // pin — the assignment was made at link time and must never be reassigned
  // by a later edit, so the list's fresher "next unpaid" is not shown.
  const selectedCost = recurringCosts.find((cost) => cost.id === recurringCostId)
  const payingOccurrenceDate =
    selectedCost === undefined
      ? null
      : isEditing && editing !== null && recurringCostId === editing.recurring_cost_id
        ? editing.occurrence_date
        : selectedCost.next_unpaid_occurrence_date

  // The same read on the income side (issue #61): the stored pin while the
  // form is editing the very link already on the Transaction, the freshest
  // "next unpaid" from the API for any new or switched link.
  const selectedIncome = recurringIncomes.find(
    (income) => income.id === recurringIncomeId,
  )
  const payingIncomeOccurrenceDate =
    selectedIncome === undefined
      ? null
      : isEditing &&
          editing !== null &&
          recurringIncomeId === editing.recurring_income_id
        ? editing.occurrence_date
        : selectedIncome.next_unpaid_occurrence_date

  const sourceWallet = wallets.find((w) => w.id === sourceWalletId)
  const destinationWallet = wallets.find((w) => w.id === destinationWalletId)
  const sourceIsContact = sourceWallet?.type === 'contact'
  const destinationIsContact = destinationWallet?.type === 'contact'
  // ADR-0027: a Transfer may carry the matching-direction recurring link
  // only when its legs are exactly one own Wallet and one Contact Wallet —
  // money in from a Contact Wallet (source = Contact) offers Recurring
  // Incomes, money out to a Contact Wallet (destination = Contact) offers
  // Recurring Costs. Own↔own, Contact↔Contact, and a missing leg never
  // qualify. The pickers below render exactly when their side qualifies,
  // and the payload sends null for a side that does not, so a stale draft
  // can never ride along to the API.
  const transferCostQualifies =
    isTransfer && destinationIsContact && !sourceIsContact
  const transferIncomeQualifies =
    isTransfer && sourceIsContact && !destinationIsContact
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
            // The matching-direction link rides only a qualifying pair
            // (ADR-0027): the other side is sent null, so a draft picked
            // for a pair that no longer qualifies never reaches the API.
            recurringCostId: transferCostQualifies ? recurringCostId : null,
            recurringIncomeId: transferIncomeQualifies ? recurringIncomeId : null,
            description,
            ...latLngToWire(finalLocation),
            ...placeToWire(place),
          }
        : {
            type,
            amount,
            date,
            walletId: walletId as number,
            categoryId,
            recurringCostId: type === 'expense' ? recurringCostId : null,
            recurringIncomeId: type === 'income' ? recurringIncomeId : null,
            description,
            ...latLngToWire(finalLocation),
            ...placeToWire(place),
          }
      const saved =
        isEditing && editing !== null
          ? await updateTransaction(token, editing.id, {
              amount,
              date,
              description,
              ...(isTransfer ? {} : { categoryId }),
              // The link rides the PATCH only when it changed: absent means
              // "keep the stored pin" — a date-only edit must never
              // reassign the paid Occurrence (issue #57).
              ...(recurringCostId !== (editing.recurring_cost_id ?? null)
                ? { recurringCostId }
                : {}),
              // The Recurring Income link follows the same contract (issue
              // #61): only a changed link is sent, so an untouched pin is
              // never re-pinned.
              ...(recurringIncomeId !== (editing.recurring_income_id ?? null)
                ? { recurringIncomeId }
                : {}),
              ...latLngToWire(location),
              // The Place follows the location: values set it, null clears it
              // (ADR-0005), so a re-pick by tap or GPS reaches the API.
              ...placeToWire(place),
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
    setGpsError(null)
    setLocating(true)
    try {
      const position = await getGpsPosition()
      if (position !== null) {
        locationTouched.current = true
        setLocation(position)
        // A GPS pick is coordinates-only and clears any stored Place
        // (ADR-0005): the name must always match the coordinates.
        setPlace(null)
        setShowingPicker(false)
        markGpsGranted()
      } else {
        // Denied, timed out, or unavailable: say so instead of failing
        // silently, with the map picker still one tap away (issue #35).
        setGpsError("Couldn't get your location — check permissions or pick it on the map.")
      }
    } finally {
      setLocating(false)
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
          wallets={assignableWallets}
          sourceWalletId={sourceWalletId}
          destinationWalletId={destinationWalletId}
          disabled={isEditing}
          onSourceChange={setSourceWalletId}
          onDestinationChange={setDestinationWalletId}
          onAdd={(target) => onAddWallet(target, type)}
        />
      ) : (
        <WalletField
          wallets={assignableWallets}
          type={type}
          value={walletId}
          disabled={isEditing}
          onChange={setWalletId}
          onAdd={() => onAddWallet('wallet', type)}
        />
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
          onAdd={() => onAddCategory(type)}
        />
      )}

      {!isTransfer && type === 'expense' && (
        <RecurringCostField
          costs={recurringCosts}
          value={recurringCostId}
          occurrenceDate={payingOccurrenceDate}
          onChange={setRecurringCostId}
          onAdd={onAddRecurringCost}
        />
      )}

      {!isTransfer && type === 'income' && (
        <RecurringIncomeField
          incomes={recurringIncomes}
          value={recurringIncomeId}
          occurrenceDate={payingIncomeOccurrenceDate}
          onChange={setRecurringIncomeId}
          onAdd={onAddRecurringIncome}
        />
      )}

      {/* ADR-0027: the same pickers ride a Transfer whose pair qualifies —
      money out to a Contact Wallet pays a Recurring Cost, money in from a
      Contact Wallet receives a Recurring Income — mirroring the
      Expense/Income fields: None unlinks, the sentinel creates inline, the
      helper names the Occurrence the link pays. */}
      {isTransfer && transferCostQualifies && (
        <RecurringCostField
          costs={recurringCosts}
          value={recurringCostId}
          occurrenceDate={payingOccurrenceDate}
          onChange={setRecurringCostId}
          onAdd={onAddRecurringCost}
        />
      )}

      {isTransfer && transferIncomeQualifies && (
        <RecurringIncomeField
          incomes={recurringIncomes}
          value={recurringIncomeId}
          occurrenceDate={payingIncomeOccurrenceDate}
          onChange={setRecurringIncomeId}
          onAdd={onAddRecurringIncome}
        />
      )}

      <div>
        <label htmlFor="tx-description" className="block text-sm font-medium text-slate-700">
          Description
        </label>
        <textarea
          ref={descriptionField}
          id="tx-description"
          rows={descriptionRows}
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional note"
          className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <span className="block text-sm font-medium text-slate-700">Location</span>
        {location !== null ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-700">
              📍 {place !== null ? place.name : formatLocation(location)}
            </span>
            <a
              href={mapLink(location, place)}
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
                setLocation(null)
                // Removing the location removes its Place with it (ADR-0005):
                // a Place never survives without coordinates.
                setPlace(null)
                setLocationOptedOut(true)
                setGpsError(null)
                // The opt-out is a create-form decision (issue #25): removing
                // a location on a new Transaction disables the GPS prefill
                // for the session; editing is unaffected.
                if (!isEditing) {
                  markLocationOptOut()
                }
                setShowingPicker(false)
              }}
              className="rounded px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 active:bg-red-100"
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
              onPick={(picked, pickedPlace) => {
                locationTouched.current = true
                setLocation(picked)
                // A pick that carries a Place sets it; a coordinates-only
                // pick (bare-map/Leaflet tap, GPS, failed lookup) clears it.
                setPlace(pickedPlace ?? null)
                setShowingPicker(false)
                setGpsError(null)
              }}
            />
            <button
              type="button"
              onClick={() => setShowingPicker(false)}
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="mt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowingPicker(true)}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200"
              >
                {location !== null ? 'Change location' : 'Add location'}
              </button>
              <button
                type="button"
                onClick={pickFromGps}
                disabled={locating}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-60"
              >
                {locating ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"
                    />
                    Locating…
                  </span>
                ) : (
                  'Use my location'
                )}
              </button>
            </div>
            {gpsError !== null && <p className="mt-2 text-xs text-red-600">{gpsError}</p>}
          </>
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
