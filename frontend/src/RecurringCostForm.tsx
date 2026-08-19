import { useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createRecurringCost,
  deleteRecurringCost,
  updateRecurringCost,
  type Category,
  type IntervalUnit,
  type RecurringCost,
  type RecurringCostInput,
  type Wallet,
} from './api'

const UNIT_OPTIONS: { value: IntervalUnit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
]

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1)
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1)

type RecurringCostFormProps = {
  cost?: RecurringCost
  wallets: Wallet[]
  categories: Category[]
  onSaved: (cost: RecurringCost) => void
  onDeleted?: (costId: number) => void
  onCancel: () => void
}

/** The create/edit/delete form for a Recurring Cost, hosted in the modal
 * shell (RecurringCostModal). Fields: Name, Amount, Wallet (active,
 * non-Contact only — costs behave like Expenses), an optional expense-only
 * Category, the interval (every N days/weeks/months/years), an optional
 * start date (unset defaults to the creation date), and the due-date
 * override that follows the interval unit — a day-of-month for months, a
 * month+day for years, nothing for days/weeks (ADR-0010). Cancel — like the
 * shell's backdrop and Escape — abandons the draft without saving. */
export function RecurringCostForm({
  cost,
  wallets,
  categories,
  onSaved,
  onDeleted,
  onCancel,
}: RecurringCostFormProps) {
  const editing = cost !== undefined
  // Costs live on active, non-Contact Wallets only (CONTEXT.md). While
  // editing, the cost's own Wallet stays selectable even if it no longer
  // qualifies, so the backend guard — not a silent re-point — decides.
  const eligibleWallets = wallets.filter(
    (wallet) => !wallet.frozen && wallet.type !== 'contact',
  )
  const walletOptions =
    editing && cost !== undefined && !eligibleWallets.some((w) => w.id === cost.wallet_id)
      ? [wallets.find((w) => w.id === cost.wallet_id), ...eligibleWallets].filter(
          (w): w is Wallet => w !== undefined,
        )
      : eligibleWallets
  const categoryOptions = categories.filter((category) => category.type === 'expense')

  const [name, setName] = useState(cost?.name ?? '')
  const [amount, setAmount] = useState(cost?.amount ?? '')
  const [walletId, setWalletId] = useState<number | ''>(
    cost?.wallet_id ?? walletOptions[0]?.id ?? '',
  )
  const [categoryId, setCategoryId] = useState<number | ''>(cost?.category_id ?? '')
  const [intervalValue, setIntervalValue] = useState(
    String(cost?.interval_value ?? 1),
  )
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    cost?.interval_unit ?? 'months',
  )
  const [startDate, setStartDate] = useState(cost?.start_date ?? '')
  const [dueDay, setDueDay] = useState<number | ''>(cost?.due_day ?? '')
  const [dueMonth, setDueMonth] = useState<number | ''>(cost?.due_month ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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

  const buildInput = (): RecurringCostInput => {
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
        ? await updateRecurringCost(token, cost.id, buildInput())
        : await createRecurringCost(token, buildInput())
      onSaved(saved)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              'A recurring cost with this name already exists.',
              editing
                ? 'Could not save the recurring cost.'
                : 'Could not create the recurring cost.',
            )
          : 'Something went wrong.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (cost === undefined) {
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
      await deleteRecurringCost(token, cost.id)
      onDeleted?.(cost.id)
    } catch {
      setError('Could not delete the recurring cost.')
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {editing ? 'Edit recurring cost' : 'New recurring cost'}
      </h2>

      <div>
        <label htmlFor="recurring-cost-name" className="block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="recurring-cost-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Rent"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="recurring-cost-amount" className="block text-sm font-medium text-slate-700">
          Amount
        </label>
        <input
          id="recurring-cost-amount"
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

      <div>
        <label htmlFor="recurring-cost-wallet" className="block text-sm font-medium text-slate-700">
          Wallet
        </label>
        <select
          id="recurring-cost-wallet"
          required
          value={walletId}
          onChange={(event) => setWalletId(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          {walletOptions.map((wallet) => (
            <option key={wallet.id} value={wallet.id}>
              {wallet.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Costs live on Checking, Credit Card, and Cash wallets.
        </p>
      </div>

      <div>
        <label htmlFor="recurring-cost-category" className="block text-sm font-medium text-slate-700">
          Category (optional)
        </label>
        <select
          id="recurring-cost-category"
          value={categoryId}
          onChange={(event) =>
            setCategoryId(event.target.value === '' ? '' : Number(event.target.value))
          }
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
        >
          <option value="">None</option>
          {categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="block text-sm font-medium text-slate-700">Repeats</span>
        <div className="mt-1 flex gap-2">
          <input
            id="recurring-cost-interval"
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
            id="recurring-cost-unit"
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
        <label htmlFor="recurring-cost-start" className="block text-sm font-medium text-slate-700">
          Start date (optional)
        </label>
        <input
          id="recurring-cost-start"
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
          <label htmlFor="recurring-cost-due-day" className="block text-sm font-medium text-slate-700">
            Due day (optional)
          </label>
          <select
            id="recurring-cost-due-day"
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
              id="recurring-cost-due-month"
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
              id="recurring-cost-due-day"
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
          {submitting ? 'Saving…' : editing ? 'Save' : 'Create recurring cost'}
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
              : 'Delete recurring cost'}
        </button>
      )}
    </form>
  )
}
