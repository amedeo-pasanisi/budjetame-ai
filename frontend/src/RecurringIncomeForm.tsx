import { useEffect, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createRecurringIncome,
  deleteRecurringIncome,
  updateRecurringIncome,
  type Category,
  type IntervalUnit,
  type RecurringIncome,
  type RecurringIncomeInput,
  type Wallet,
} from './api'
import { EntitySelect } from './EntitySelect'

const UNIT_OPTIONS: { value: IntervalUnit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
]

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1)
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1)

type RecurringIncomeFormProps = {
  income?: RecurringIncome
  wallets: Wallet[]
  categories: Category[]
  onSaved: (income: RecurringIncome) => void
  onDeleted?: (incomeId: number) => void
  onCancel: () => void
  /** Inline entity creation (ADR-0013): opens the Category create modal
   * hosted by the screen. */
  onAddCategory: () => void
  /** The freshly created Category the screen reports back: the field selects
   * it, leaving the rest of the draft untouched. */
  categoryToSelect: number | null
  /** Inline entity creation (ADR-0013): opens the Wallet create modal
   * hosted by the screen. */
  onAddWallet: () => void
  /** The freshly created Wallet the screen reports back: the field selects
   * it, leaving the rest of the draft untouched. */
  walletToSelect: number | null
}

/** The create/edit/delete form for a Recurring Income, hosted in the modal
 * shell (RecurringIncomeModal). Fields mirror the Costs side (issue #56,
 * ADR-0011): Name, Amount, Wallet (active, non-Contact only — incomes behave
 * like Income Transactions, with the inline "＋ Add wallet…" sentinel,
 * ADR-0013), an optional income-only Category (with its own inline
 * "＋ Add category…" sentinel, ADR-0013), the interval
 * (every N days/weeks/months/years), an optional start date (unset defaults
 * to the creation date), and the due-date override that follows the interval
 * unit — a day-of-month for months, a month+day for years, nothing for
 * days/weeks (ADR-0010). Cancel — like the shell's backdrop and Escape —
 * abandons the draft without saving. */
export function RecurringIncomeForm({
  income,
  wallets,
  categories,
  onSaved,
  onDeleted,
  onCancel,
  onAddCategory,
  categoryToSelect,
  onAddWallet,
  walletToSelect,
}: RecurringIncomeFormProps) {
  const editing = income !== undefined
  // Incomes live on active, non-Contact Wallets only (CONTEXT.md). While
  // editing, the income's own Wallet stays selectable even if it no longer
  // qualifies, so the backend guard — not a silent re-point — decides.
  const eligibleWallets = wallets.filter(
    (wallet) => !wallet.frozen && wallet.type !== 'contact',
  )
  const walletOptions =
    editing && income !== undefined && !eligibleWallets.some((w) => w.id === income.wallet_id)
      ? [wallets.find((w) => w.id === income.wallet_id), ...eligibleWallets].filter(
          (w): w is Wallet => w !== undefined,
        )
      : eligibleWallets
  const categoryOptions = categories.filter((category) => category.type === 'income')

  const [name, setName] = useState(income?.name ?? '')
  const [amount, setAmount] = useState(income?.amount ?? '')
  const [walletId, setWalletId] = useState<number | ''>(
    income?.wallet_id ?? walletOptions[0]?.id ?? '',
  )
  const [categoryId, setCategoryId] = useState<number | ''>(income?.category_id ?? '')
  const [intervalValue, setIntervalValue] = useState(
    String(income?.interval_value ?? 1),
  )
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    income?.interval_unit ?? 'months',
  )
  const [startDate, setStartDate] = useState(income?.start_date ?? '')
  const [dueDay, setDueDay] = useState<number | ''>(income?.due_day ?? '')
  const [dueMonth, setDueMonth] = useState<number | ''>(income?.due_month ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Inline entity creation (ADR-0013): when the screen's inner Category
  // modal saves, it reports the new Category's id here so this field
  // selects it — the only field that changes, the rest of the draft stays.
  useEffect(() => {
    if (categoryToSelect !== null) {
      setCategoryId(categoryToSelect)
    }
  }, [categoryToSelect])

  // The Wallet select's inline creation, same contract as the Category
  // field above: the new Wallet's id arrives from the screen and takes the
  // field, leaving the rest of the draft untouched.
  useEffect(() => {
    if (walletToSelect !== null) {
      setWalletId(walletToSelect)
    }
  }, [walletToSelect])

  // The year interval's override is a month+day pair: half a pair blocks the
  // save instead of silently dropping the override.
  const yearOverrideIncomplete =
    intervalUnit === 'years' && (dueDay === '') !== (dueMonth === '')
  const intervalNumber = Number.parseInt(intervalValue, 10)
  const amountNumber = Number.parseFloat(amount)
  const canSave =
    name.trim() !== '' &&
    amountNumber > 0 &&
    walletId !== '' &&
    intervalNumber >= 1 &&
    !yearOverrideIncomplete

  const buildInput = (): RecurringIncomeInput => {
    let finalDueDay: number | null = null
    let finalDueMonth: number | null = null
    if (intervalUnit === 'months') {
      finalDueDay = dueDay === '' ? null : dueDay
    } else if (intervalUnit === 'years') {
      if (dueDay !== '' && dueMonth !== '') {
        finalDueDay = dueDay
        finalDueMonth = dueMonth
      }
    }
    return {
      name: name.trim(),
      amount,
      walletId: walletId === '' ? 0 : walletId,
      categoryId: categoryId === '' ? null : categoryId,
      intervalValue: intervalNumber,
      intervalUnit,
      startDate: startDate === '' ? null : startDate,
      dueDay: finalDueDay,
      dueMonth: finalDueMonth,
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const saved = editing
        ? await updateRecurringIncome(token, income.id, buildInput())
        : await createRecurringIncome(token, buildInput())
      onSaved(saved)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              'A recurring income with this name already exists.',
              editing
                ? 'Could not save the recurring income.'
                : 'Could not create the recurring income.',
            )
          : 'Something went wrong.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (income === undefined) {
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
      await deleteRecurringIncome(token, income.id)
      onDeleted?.(income.id)
    } catch {
      setError('Could not delete the recurring income.')
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {editing ? 'Edit recurring income' : 'New recurring income'}
      </h2>

      <div>
        <label htmlFor="recurring-income-name" className="block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="recurring-income-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Salary"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="recurring-income-amount" className="block text-sm font-medium text-slate-700">
          Amount
        </label>
        <input
          id="recurring-income-amount"
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <EntitySelect
        id="recurring-income-wallet"
        label="Wallet"
        value={walletId}
        onChange={setWalletId}
        options={walletOptions.map((wallet) => ({ id: wallet.id, label: wallet.name }))}
        entity="wallet"
        onAdd={onAddWallet}
        required
      />
      <p className="mt-1 text-xs text-slate-500">
        Incomes live on Checking, Credit Card, and Cash wallets.
      </p>

      <EntitySelect
        id="recurring-income-category"
        label="Category (optional)"
        value={categoryId}
        onChange={setCategoryId}
        options={categoryOptions.map((category) => ({ id: category.id, label: category.name }))}
        entity="category"
        onAdd={onAddCategory}
      />

      <div>
        <span className="block text-sm font-medium text-slate-700">Repeats</span>
        <div className="mt-1 flex gap-2">
          <input
            id="recurring-income-interval"
            type="number"
            min="1"
            step="1"
            required
            value={intervalValue}
            onChange={(event) => setIntervalValue(event.target.value)}
            aria-label="Every N"
            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
          <select
            id="recurring-income-unit"
            value={intervalUnit}
            onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
            aria-label="Interval unit"
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            {UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="recurring-income-start" className="block text-sm font-medium text-slate-700">
          Start date (optional)
        </label>
        <input
          id="recurring-income-start"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          The first occurrence. Unset means today.
        </p>
      </div>

      {intervalUnit === 'months' && (
        <div>
          <label htmlFor="recurring-income-due-day" className="block text-sm font-medium text-slate-700">
            Due day (optional)
          </label>
          <select
            id="recurring-income-due-day"
            value={dueDay}
            onChange={(event) =>
              setDueDay(event.target.value === '' ? '' : Number(event.target.value))
            }
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="">None</option>
            {DAY_OPTIONS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Due on this day of the month instead of the occurrence date. Days
            29–31 fall on the last day of shorter months.
          </p>
        </div>
      )}

      {intervalUnit === 'years' && (
        <div>
          <span className="block text-sm font-medium text-slate-700">
            Due date (optional)
          </span>
          <div className="mt-1 flex gap-2">
            <select
              id="recurring-income-due-month"
              value={dueMonth}
              onChange={(event) =>
                setDueMonth(event.target.value === '' ? '' : Number(event.target.value))
              }
              aria-label="Due month"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Month</option>
              {MONTH_OPTIONS.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
            <select
              id="recurring-income-due-day"
              value={dueDay}
              onChange={(event) =>
                setDueDay(event.target.value === '' ? '' : Number(event.target.value))
              }
              aria-label="Due day"
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Day</option>
              {DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>
          {yearOverrideIncomplete && (
            <p className="mt-1 text-xs text-amber-600">
              Pick both the month and the day, or leave both unset.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Due on this month and day of each year. Days 29–31 fall on the
            last day of shorter months.
          </p>
        </div>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || !canSave}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : editing ? 'Save' : 'Create recurring income'}
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

      {editing && onDeleted !== undefined && (
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
          {submitting
            ? 'Deleting…'
            : confirmingDelete
              ? 'Tap again to confirm'
              : 'Delete recurring income'}
        </button>
      )}
    </form>
  )
}
