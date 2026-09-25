import { useEffect, useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createRecurringIncome,
  freezeRecurringIncome,
  unfreezeRecurringIncome,
  fetchRecurringIncomeOccurrences,
  setRecurringIncomeOccurrenceSkipped,
  updateRecurringIncome,
  type IntervalUnit,
  type RecurringIncome,
  type RecurringIncomeInput,
  type RecurringOccurrence,
} from './api'
import { intervalText } from './recurringIncomes'
import { FieldError } from './FieldError'
import { fieldErrorProps, parseAmount, type FieldErrors } from './validation'

const UNIT_OPTIONS: { value: IntervalUnit; oneId: string; manyId: string }[] = [
  { value: 'days', oneId: 'interval.day', manyId: 'interval.days' },
  { value: 'weeks', oneId: 'interval.week', manyId: 'interval.weeks' },
  { value: 'months', oneId: 'interval.month', manyId: 'interval.months' },
  { value: 'years', oneId: 'interval.year', manyId: 'interval.years' },
]

type RecurringIncomeFormProps = {
  income?: RecurringIncome
  onSaved: (income: RecurringIncome) => void
  onFreeze?: (income: RecurringIncome) => void
  onUnfreeze?: (income: RecurringIncome) => void
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
 * abandons the draft without saving. Field Errors (ADR-0029) reveal inline
 * under each wrong field on a Save attempt; frozen/read-only rendering
 * never validates. */

type RecurringIncomeDraft = {
  name: string
  amount: string
  interval: string
  editing: boolean
  startDate: string
}

/** Submit-and-validate (ADR-0029): the Recurring Income form's pure
 * validation. Returns i18n message IDs keyed by field — the form translates
 * them through `formatMessage` before passing to FieldError. Runs on every
 * Save click before any API call; a form with errors submits nothing.
 * Reuses the shared tolerant amount parser from the validation layer (issue
 * #102). The interval is a whole number of units: empty, non-integer, or
 * below 1 is one message. The Start date is only mandatory while editing
 * (ADR-0024): at creation an empty one stays allowed — the first Occurrence
 * becomes today. */
function validate(draft: RecurringIncomeDraft): FieldErrors {
  const errors: FieldErrors = {}
  if (draft.name.trim() === '') {
    errors.name = 'recurringIncomeForm.validation.nameEmpty'
  }
  const trimmedAmount = draft.amount.trim()
  if (trimmedAmount === '') {
    errors.amount = 'recurringIncomeForm.validation.amountEmpty'
  } else if (parseAmount(trimmedAmount) === null) {
    errors.amount = /^-?\d+([.,]\d+)?$/.test(trimmedAmount)
      ? 'recurringIncomeForm.validation.amountNotPositive'
      : 'recurringIncomeForm.validation.amountInvalid'
  }
  const interval = draft.interval.trim()
  if (interval === '' || !/^\d+$/.test(interval) || Number(interval) < 1) {
    errors.interval = 'recurringIncomeForm.validation.intervalEmpty'
  }
  if (draft.editing && draft.startDate.trim() === '') {
    errors.start = 'recurringIncomeForm.validation.startEmpty'
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

export function RecurringIncomeForm({
  income,
  onSaved,
  onFreeze,
  onUnfreeze,
  onCancel,
}: RecurringIncomeFormProps) {
  const { formatMessage } = useIntl()
  const editing = income !== undefined
  const readOnly = income?.frozen === true

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
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [occurrences, setOccurrences] = useState<RecurringOccurrence[] | null>(
    null,
  )
  const [occurrencesError, setOccurrencesError] = useState<string | null>(null)
  const [togglingDate, setTogglingDate] = useState<string | null>(null)
  const incomeId = income?.id

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
          setOccurrencesError(formatMessage({ id: 'recurringIncomeForm.occurrencesError' }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, incomeId, formatMessage])

  const handleToggleOccurrence = (row: RecurringOccurrence) => {
    if (incomeId === undefined) {
      return
    }
    setTogglingDate(row.date)
    setOccurrencesError(null)
    setRecurringIncomeOccurrenceSkipped(token, incomeId, row.date, !row.skipped)
      .then((rows) => setOccurrences(rows))
      .catch(() => setOccurrencesError(formatMessage({ id: 'recurringIncomeForm.error.occurrenceUpdate' })))
      .finally(() => setTogglingDate(null))
  }

  const intervalNumber = Number.parseInt(intervalValue, 10)

  const buildInput = (): RecurringIncomeInput => ({
    name: name.trim(),
    amount: (parseAmount(amount) ?? 0).toFixed(2),
    intervalValue: intervalNumber,
    intervalUnit,
    startDate: startDate === '' ? null : startDate,
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fieldErrors = validate({
      name,
      amount,
      interval: intervalValue,
      editing,
      startDate,
    })
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(translateErrors(fieldErrors, formatMessage))
      return
    }
    setErrors({})
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
              formatMessage({ id: 'recurringIncomeForm.error.conflict' }),
              editing
                ? formatMessage({ id: 'recurringIncomeForm.error.save' })
                : formatMessage({ id: 'recurringIncomeForm.error.create' }),
            )
          : formatMessage({ id: 'recurringIncomeForm.error.generic' }),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleFreeze = async () => {
    if (income === undefined || income.frozen) {
      return
    }
    if (!confirmingFreeze) {
      setConfirmingFreeze(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const frozen = await freezeRecurringIncome(token, income.id)
      setConfirmingFreeze(false)
      onFreeze?.(frozen)
    } catch {
      setError(formatMessage({ id: 'recurringIncomeForm.error.freeze' }))
      setSubmitting(false)
    }
  }

  const handleUnfreeze = async () => {
    if (income === undefined || !income.frozen) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const unfrozen = await unfreezeRecurringIncome(token, income.id)
      onUnfreeze?.(unfrozen)
    } catch {
      setError(formatMessage({ id: 'recurringIncomeForm.error.unfreeze' }))
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {formatMessage({ id: editing ? 'recurringIncomeForm.title.edit' : 'recurringIncomeForm.title.new' })}
      </h2>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-income-name"} className="block text-sm font-medium text-slate-700">
          {formatMessage({ id: 'recurringIncomeForm.name' })}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{name}</p>
        ) : (
          <input
            id="recurring-income-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={formatMessage({ id: 'recurringIncomeForm.namePlaceholder' })}
            {...fieldErrorProps('name', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="name" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-income-amount"} className="block text-sm font-medium text-slate-700">
          {formatMessage({ id: 'recurringIncomeForm.amount' })}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{amount}</p>
        ) : (
          <input
            id="recurring-income-amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={formatMessage({ id: 'recurringIncomeForm.amountPlaceholder' })}
            {...fieldErrorProps('amount', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="amount" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-income-interval"} className="block text-sm font-medium text-slate-700">
          {formatMessage({ id: 'recurringIncomeForm.repeatsEvery' })}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">
            {intervalText(intervalNumber, intervalUnit)}
          </p>
        ) : (
          <div className="mt-1 flex gap-2">
            <input
              id="recurring-income-interval"
              type="number"
              min="1"
              step="1"
              required
              value={intervalValue}
              onChange={(event) => setIntervalValue(event.target.value)}
              aria-label={formatMessage({ id: 'recurringIncomeForm.everyNAria' })}
              {...fieldErrorProps('interval', errors)}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <select
              id="recurring-income-unit"
              value={intervalUnit}
              onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
              aria-label={formatMessage({ id: 'recurringIncomeForm.intervalUnitAria' })}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            >
              {UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatMessage({ id: intervalNumber === 1 ? option.oneId : option.manyId })}
                </option>
              ))}
            </select>
          </div>
        )}
        <FieldError field="interval" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-income-start"} className="block text-sm font-medium text-slate-700">
          {formatMessage({ id: 'recurringIncomeForm.startDate' })}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{startDate}</p>
        ) : (
          <input
            id="recurring-income-start"
            type="date"
            required={editing}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            {...fieldErrorProps('start', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="start" errors={errors} />
        {!editing && (
          <p className="mt-1 text-xs text-slate-500">
            {formatMessage({ id: 'recurringIncomeForm.startHint' })}
          </p>
        )}
      </div>

      {editing && !readOnly && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-700">{formatMessage({ id: 'recurringIncomeForm.occurrences' })}</h3>
          {occurrencesError !== null && (
            <p className="text-sm text-red-600">{occurrencesError}</p>
          )}
          {occurrences === null ? (
            occurrencesError === null && (
              <p className="text-xs text-slate-500">{formatMessage({ id: 'recurringIncomeForm.occurrencesLoading' })}</p>
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
                        {formatMessage({ id: 'recurringIncomeForm.occurrenceSkipped' })}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleOccurrence(row)}
                    disabled={togglingDate === row.date}
                    className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {row.skipped ? formatMessage({ id: 'recurringIncomeForm.unskip' }) : formatMessage({ id: 'recurringIncomeForm.skip' })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">
            {formatMessage({ id: 'recurringIncomeForm.occurrenceHelp' })}
          </p>
        </div>
      )}

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      {!readOnly && (
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || togglingDate !== null}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {submitting
              ? formatMessage({ id: 'recurringIncomeForm.saving' })
              : editing
                ? formatMessage({ id: 'recurringIncomeForm.save' })
                : formatMessage({ id: 'recurringIncomeForm.create' })}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
          >
            {formatMessage({ id: 'recurringIncomeForm.cancel' })}
          </button>
        </div>
      )}

      {editing && readOnly && onUnfreeze !== undefined && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleUnfreeze}
            disabled={submitting}
            className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100"
          >
            {submitting
              ? formatMessage({ id: 'recurringIncomeForm.unfreezing' })
              : formatMessage({ id: 'recurringIncomeForm.unfreeze' })}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
          >
            {formatMessage({ id: 'recurringIncomeForm.cancel' })}
          </button>
        </div>
      )}

      {editing && !readOnly && onFreeze !== undefined && (
        <button
          type="button"
          onClick={handleFreeze}
          disabled={submitting}
          className={`w-full rounded-lg border px-4 py-2 text-sm font-medium ${
            confirmingFreeze
              ? 'border-red-600 bg-red-600 text-white'
              : 'border-red-200 text-red-600'
          }`}
        >
          {submitting
            ? formatMessage({ id: 'recurringIncomeForm.freezing' })
            : confirmingFreeze
              ? formatMessage({ id: 'recurringIncomeForm.freezeConfirm' })
              : formatMessage({ id: 'recurringIncomeForm.freeze' })}
        </button>
      )}
    </form>
  )
}