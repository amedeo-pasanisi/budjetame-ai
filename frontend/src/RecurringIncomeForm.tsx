import { useEffect, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createRecurringIncome,
  deleteRecurringIncome,
  fetchRecurringIncomeOccurrences,
  setRecurringIncomeOccurrenceSkipped,
  updateRecurringIncome,
  type IntervalUnit,
  type RecurringIncome,
  type RecurringIncomeInput,
  type RecurringOccurrence,
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
 * definition itself never carries them.
 *
 * Edit mode adds the Occurrences section (ADR-0026), mirroring the Costs
 * side: every non-Paid Occurrence, newest first — the next incoming Unpaid
 * one on top, then every excused future row, then the past rows (today
 * first) down to the oldest — each with its own Skip/Un-skip: Skip
 * excuses the Occurrence (it never enters the Backlog and a link can
 * never pay it), Un-skip restores it. The rows come from their own
 * per-definition read; a toggle states the row's skipped state and swaps
 * in the refreshed read. Cancel — like the shell's backdrop and Escape —
 * abandons the draft without saving. */
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
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  // The Occurrences section's rows (ADR-0026): their own read, loaded when
  // an existing definition opens the form (a definition under creation has
  // no id yet — its first Occurrence is only decided at creation). Null
  // while the read is still in flight.
  const [occurrences, setOccurrences] = useState<RecurringOccurrence[] | null>(
    null,
  )
  const [occurrencesError, setOccurrencesError] = useState<string | null>(null)
  // The row whose Skip/Un-skip write is in flight — it disables itself so a
  // double tap cannot fire two writes (the write is idempotent anyway).
  const [togglingDate, setTogglingDate] = useState<string | null>(null)
  const incomeId = income?.id

  // Load the Occurrences section when an existing definition is edited. The
  // rows are the section's own truth: a toggle below replaces them with the
  // refreshed read from the write's response.
  useEffect(() => {
    if (incomeId === undefined) {
      return
    }
    let cancelled = false
    fetchRecurringIncomeOccurrences(token, incomeId)
      .then((rows) => {
        if (!cancelled) {
          setOccurrences(rows)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOccurrencesError('Could not load the occurrences.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, incomeId])

  // One row's Skip/Un-skip (ADR-0026): state the row's skipped state — the
  // response is the refreshed read, so the section swaps its rows in
  // without a second fetch. The write also refreshes the definition's
  // derived state (the cards behind reload on the cache clock, ADR-0022).
  const handleToggleOccurrence = (row: RecurringOccurrence) => {
    if (incomeId === undefined) {
      return
    }
    setTogglingDate(row.date)
    setOccurrencesError(null)
    setRecurringIncomeOccurrenceSkipped(token, incomeId, row.date, !row.skipped)
      .then((rows) => setOccurrences(rows))
      .catch(() => setOccurrencesError('Could not update the occurrence.'))
      .finally(() => setTogglingDate(null))
  }

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

      {/* The Occurrences section (ADR-0026) — edit mode only: a definition
          under creation has no id yet. Rows are the definition's non-Paid
          Occurrences, newest first, in the order the read returns: the
          next incoming Unpaid one on top, then every excused future row,
          then the past rows (today first) down to the oldest. Skipped
          rows stay greyed with Un-skip, so every excused Occurrence stays
          reachable; a row's own toggle works in any order. */}
      {editing && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-700">Occurrences</h3>
          {occurrencesError !== null && (
            <p className="text-sm text-red-600">{occurrencesError}</p>
          )}
          {occurrences === null ? (
            occurrencesError === null && (
              <p className="text-xs text-slate-500">Loading occurrences…</p>
            )
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {occurrences.map((row) => (
                <li
                  key={row.date}
                  className="flex items-center justify-between gap-3 py-2 pl-3 pr-2"
                >
                  <span className="min-w-0">
                    <span
                      className={`block text-sm ${
                        row.skipped
                          ? 'text-slate-400'
                          : 'font-medium text-slate-900'
                      }`}
                    >
                      {row.date}
                    </span>
                    {row.skipped && (
                      <span className="block text-xs text-slate-400">
                        Skipped — un-skip to pay it
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleOccurrence(row)}
                    disabled={togglingDate === row.date}
                    className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {row.skipped ? 'Un-skip' : 'Skip'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">
            Skip excuses an occurrence: it never counts as unpaid, and a
            payment covers it only after un-skipping. Paid ones live in the
            ledger.
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
