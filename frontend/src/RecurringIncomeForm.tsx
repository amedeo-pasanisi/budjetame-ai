import { useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createRecurringIncome,
  deleteRecurringIncome,
  updateRecurringIncome,
  type IntervalUnit,
  type RecurringIncome,
  type RecurringIncomeInput,
} from './api'

const UNIT_OPTIONS: { value: IntervalUnit; one: string; many: string }[] = [
  { value: 'days', one: 'Day', many: 'Days' },
  { value: 'weeks', one: 'Week', many: 'Weeks' },
  { value: 'months', one: 'Month', many: 'Months' },
  { value: 'years', one: 'Year', many: 'Years' },
]

type RecurringIncomeFormProps = {
  income?: RecurringIncome
  onSaved: (income: RecurringIncome) => void
  onDeleted?: (incomeId: number) => void
  onCancel: () => void
}

/** The create/edit/delete form for a Recurring Income, hosted in the modal
 * shell (RecurringIncomeModal). Fields mirror the Costs side (issue #56,
 * ADR-0011): Name, Amount, the interval
 * ("Repeats every N days/weeks/months/years" — the unit reads singular when
 * N is 1), and the start date: the first Occurrence, the one date the
 * definition carries (ADR-0024). Left empty at creation it becomes the
 * creation day — so "start today" needs no typing — while editing always
 * shows a date, and an empty one blocks the save: the date can be changed,
 * never unset. Occurrences repeat on the start date's day from there on
 * (29–31 clamp to the last day of shorter months). The Wallet and Category
 * of a linked Income are chosen at Transaction creation time, so the
 * definition itself never carries them. Cancel — like the shell's backdrop
 * and Escape — abandons the draft without saving. */
export function RecurringIncomeForm({
  income,
  onSaved,
  onDeleted,
  onCancel,
}: RecurringIncomeFormProps) {
  const editing = income !== undefined

  const [name, setName] = useState(income?.name ?? '')
  const [amount, setAmount] = useState(income?.amount ?? '')
  const [intervalValue, setIntervalValue] = useState(
    String(income?.interval_value ?? 1),
  )
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    income?.interval_unit ?? 'months',
  )
  const [startDate, setStartDate] = useState(income?.start_date ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const intervalNumber = Number.parseInt(intervalValue, 10)
  const amountNumber = Number.parseFloat(amount)
  const canSave =
    name.trim() !== '' &&
    amountNumber > 0 &&
    intervalNumber >= 1 &&
    // The start date is only optional at creation (empty = today); an
    // existing definition always carries one (ADR-0024).
    (!editing || startDate !== '')

  const buildInput = (): RecurringIncomeInput => ({
    name: name.trim(),
    amount,
    intervalValue: intervalNumber,
    intervalUnit,
    startDate: startDate === '' ? null : startDate,
  })

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

      <div>
        <label htmlFor="recurring-income-interval" className="block text-sm font-medium text-slate-700">
          Repeats every
        </label>
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
                {intervalNumber === 1 ? option.one : option.many}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="recurring-income-start" className="block text-sm font-medium text-slate-700">
          Start date
        </label>
        <input
          id="recurring-income-start"
          type="date"
          required={editing}
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
        />
        {!editing && (
          <p className="mt-1 text-xs text-slate-500">
            The first occurrence. Leave empty to start today.
          </p>
        )}
      </div>

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
