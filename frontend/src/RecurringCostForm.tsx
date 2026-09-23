import { useEffect, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createRecurringCost,
  freezeRecurringCost,
  unfreezeRecurringCost,
  fetchRecurringCostOccurrences,
  setRecurringCostOccurrenceSkipped,
  updateRecurringCost,
  type IntervalUnit,
  type RecurringCost,
  type RecurringCostInput,
  type RecurringOccurrence,
} from './api'
import { intervalText } from './recurringCosts'
import { FieldError } from './FieldError'
import { fieldErrorProps, parseAmount, type FieldErrors } from './validation'

const UNIT_OPTIONS: { value: IntervalUnit; one: string; many: string }[] = [
  { value: 'days', one: 'Day', many: 'Days' },
  { value: 'weeks', one: 'Week', many: 'Weeks' },
  { value: 'months', one: 'Month', many: 'Months' },
  { value: 'years', one: 'Year', many: 'Years' },
]

type RecurringCostFormProps = {
  cost?: RecurringCost
  onSaved: (cost: RecurringCost) => void
  onFreeze?: (cost: RecurringCost) => void
  onUnfreeze?: (cost: RecurringCost) => void
  onCancel: () => void
}

/** The create/edit/delete form for a Recurring Cost, hosted in the modal
 * shell (RecurringCostModal). Fields: Name, Amount, the interval
 * ("Repeats every N days/weeks/months/years" — the unit reads singular when
 * N is 1), and the start date: the first Occurrence, the one date the
 * definition carries (ADR-0024). Left empty at creation it becomes the
 * creation day — so "start today" needs no typing — while editing always
 * shows a date, and an empty one blocks the save: the date can be changed,
 * never unset. Occurrences repeat on the start date's day from there on
 * (29–31 clamp to the last day of shorter months). The Wallet and Category
 * of a linked Expense are chosen at Transaction creation time, so the
 * definition itself never carries them.
 *
 * Edit mode adds the Occurrences section (ADR-0026): every non-Paid
 * Occurrence, newest first — the next incoming Unpaid one on top, then
 * every excused future row, then the past rows (today first) down to the
 * oldest — each with its own Skip/Un-skip: Skip excuses the Occurrence (it
 * never enters the Backlog and a link can never pay it), Un-skip restores
 * it. The rows come from their own per-definition read; a toggle states
 * the row's skipped state and swaps in the refreshed read, and the write
 * refreshes the derived state (badge, next due date) on the cards behind.
 * Cancel — like the shell's backdrop and Escape — abandons the draft
 * without saving. Field Errors (ADR-0029) reveal inline under each wrong
 * field on a Save attempt; frozen/read-only rendering never validates. */

/** The Recurring Cost form's draft, as submit-and-validate (ADR-0029) sees
 * it: everything that can be wrong, in one flat record, so the pure
 * `validate()` below can judge it without touching React. */
type RecurringCostDraft = {
  name: string
  amount: string
  interval: string
  editing: boolean
  startDate: string
}

/** Submit-and-validate (ADR-0029): the Recurring Cost form's pure
 * validation. Returns one Field Error per wrong field — keyed by the error
 * keys the fields render under — and nothing for a valid form. Runs on
 * every Save click before any API call; a form with errors submits
 * nothing. Reuses the shared tolerant amount parser from the validation
 * layer (issue #102), never re-implementing it: an empty Amount is its own
 * message, an unparseable one (letters, signs, malformed groupings)
 * another, and a parseable-but-non-positive one a third. The interval is
 * a whole number of units: empty, non-integer, or below 1 is one message.
 * The Start date is only mandatory while editing (ADR-0024): at creation
 * an empty one stays allowed — the first Occurrence becomes today. */
function validate(draft: RecurringCostDraft): FieldErrors {
  const errors: FieldErrors = {}
  if (draft.name.trim() === '') {
    errors.name = 'Enter a name'
  }
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
  const interval = draft.interval.trim()
  if (interval === '' || !/^\d+$/.test(interval) || Number(interval) < 1) {
    errors.interval = 'The interval must be at least 1'
  }
  if (draft.editing && draft.startDate.trim() === '') {
    errors.start = 'Choose a start date'
  }
  return errors
}

export function RecurringCostForm({
  cost,
  onSaved,
  onFreeze,
  onUnfreeze,
  onCancel,
}: RecurringCostFormProps) {
  const editing = cost !== undefined
  const readOnly = cost?.frozen === true

  const [name, setName] = useState(cost?.name ?? '')
  const [amount, setAmount] = useState(cost?.amount ?? '')
  const [intervalValue, setIntervalValue] = useState(
    String(cost?.interval_value ?? 1),
  )
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    cost?.interval_unit ?? 'months',
  )
  const [startDate, setStartDate] = useState(cost?.start_date ?? '')
  const [error, setError] = useState<string | null>(null)
  // Field Errors (ADR-0029): revealed by a Save attempt, they persist
  // while the user types and refresh only on the next Save click — never
  // live, never on blur.
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)
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
  const costId = cost?.id

  // Load the Occurrences section when an existing definition is edited. The
  // rows are the section's own truth: a toggle below replaces them with the
  // refreshed read from the write's response.
  useEffect(() => {
    if (costId === undefined) {
      return
    }
    let cancelled = false
    fetchRecurringCostOccurrences(token, costId)
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
  }, [token, costId])

  // One row's Skip/Un-skip (ADR-0026): state the row's skipped state — the
  // response is the refreshed read, so the section swaps its rows in
  // without a second fetch. The write also refreshes the definition's
  // derived state (the cards behind reload on the cache clock, ADR-0022).
  const handleToggleOccurrence = (row: RecurringOccurrence) => {
    if (costId === undefined) {
      return
    }
    setTogglingDate(row.date)
    setOccurrencesError(null)
    setRecurringCostOccurrenceSkipped(token, costId, row.date, !row.skipped)
      .then((rows) => setOccurrences(rows))
      .catch(() => setOccurrencesError('Could not update the occurrence.'))
      .finally(() => setTogglingDate(null))
  }

  const intervalNumber = Number.parseInt(intervalValue, 10)

  const buildInput = (): RecurringCostInput => ({
    name: name.trim(),
    // The tolerant Amount Input (ADR-0029) sends the canonical cents value —
    // "1.000,45" or "17,5" reach the API as "1000.45"/"17.50" — the
    // backend's Decimal would reject the comma or the groups.
    amount: (parseAmount(amount) ?? 0).toFixed(2),
    intervalValue: intervalNumber,
    intervalUnit,
    startDate: startDate === '' ? null : startDate,
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Submit-and-validate (ADR-0029): judge the draft first. Any Field
    // Error reveals inline under its field, and the submit ends here —
    // nothing reaches the API. A valid draft clears the errors (they
    // refresh only on this next Save attempt) and proceeds exactly as
    // before.
    const fieldErrors = validate({
      name,
      amount,
      interval: intervalValue,
      editing,
      startDate,
    })
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    setError(null)
    try {
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

  const handleFreeze = async () => {
    if (cost === undefined || cost.frozen) {
      return
    }
    if (!confirmingFreeze) {
      setConfirmingFreeze(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const frozen = await freezeRecurringCost(token, cost.id)
      setConfirmingFreeze(false)
      onFreeze?.(frozen)
    } catch {
      setError('Could not freeze the recurring cost.')
      setSubmitting(false)
    }
  }

  const handleUnfreeze = async () => {
    if (cost === undefined || !cost.frozen) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const unfrozen = await unfreezeRecurringCost(token, cost.id)
      onUnfreeze?.(unfrozen)
    } catch {
      setError('Could not unfreeze the recurring cost.')
      setSubmitting(false)
    }
  }

  return (
    // noValidate (ADR-0029): the browser's native bubbles never appear;
    // the Field Errors are the only validation voice.
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {editing ? 'Edit recurring cost' : 'New recurring cost'}
      </h2>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-cost-name"} className="block text-sm font-medium text-slate-700">
          Name
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{name}</p>
        ) : (
          <input
            id="recurring-cost-name"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Rent"
            {...fieldErrorProps('name', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="name" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-cost-amount"} className="block text-sm font-medium text-slate-700">
          Amount
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{amount}</p>
        ) : (
          // The browser-owned type="number" swallowed "17.5" in
          // comma-locales (ADR-0029): parsing is ours now — a tolerant text
          // field read by parseAmount, with the Error's aria wiring.
          <input
            id="recurring-cost-amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            {...fieldErrorProps('amount', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="amount" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-cost-interval"} className="block text-sm font-medium text-slate-700">
          Repeats every
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">
            {intervalText(intervalNumber, intervalUnit)}
          </p>
        ) : (
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
              {...fieldErrorProps('interval', errors)}
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
                  {intervalNumber === 1 ? option.one : option.many}
                </option>
              ))}
            </select>
          </div>
        )}
        <FieldError field="interval" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : "recurring-cost-start"} className="block text-sm font-medium text-slate-700">
          Start date
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{startDate}</p>
        ) : (
          <input
            id="recurring-cost-start"
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
            The first occurrence. Leave empty to start today.
          </p>
        )}
      </div>

      {/* The Occurrences section — hidden for frozen definitions: there
          are no unpaid occurrences to skip. */}
      {editing && !readOnly && (
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

      {!readOnly && (
        <div className="flex gap-3">
          {/* Submit-and-validate (ADR-0029): disabled only while work is
          actually in flight (saving, an Occurrence toggle) — never because
          the draft is invalid. An invalid draft reveals Field Errors
          instead of a dead button. */}
          <button
            type="submit"
            disabled={submitting || togglingDate !== null}
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
      )}

      {editing && readOnly && onUnfreeze !== undefined && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleUnfreeze}
            disabled={submitting}
            className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-100"
          >
            {submitting ? 'Unfreezing…' : 'Unfreeze recurring cost'}
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
            ? 'Freezing…'
            : confirmingFreeze
              ? 'Tap again to confirm freeze'
              : 'Freeze recurring cost'}
        </button>
      )}
    </form>
  )
}
