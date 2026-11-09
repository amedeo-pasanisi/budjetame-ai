import { useEffect, useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  type IntervalUnit,
  type RecurringDefinition,
  type RecurringDefinitionInput,
  type RecurringOccurrence,
} from './api'
import { FieldError } from './FieldError'
import { intervalText } from './recurringDisplay'
import { SIDES, type RecurringSide } from './recurringSide'
import { fieldErrorProps, parseAmount, type FieldErrors } from './validation'

/** Interval unit options with singular/plural display labels. */
const UNIT_OPTIONS: { value: IntervalUnit; oneId: string; manyId: string }[] = [
  { value: 'days', oneId: 'interval.day', manyId: 'interval.days' },
  { value: 'weeks', oneId: 'interval.week', manyId: 'interval.weeks' },
  { value: 'months', oneId: 'interval.month', manyId: 'interval.months' },
  { value: 'years', oneId: 'interval.year', manyId: 'interval.years' },
]

type RecurringDefinitionFormProps = {
  /** Which side of the Recurring tab the form serves: its API calls, its
   * catalog strings and its element ids come from the side table. */
  side: RecurringSide
  definition?: RecurringDefinition
  onSaved: (definition: RecurringDefinition) => void
  onFreeze?: (definition: RecurringDefinition) => void
  onUnfreeze?: (definition: RecurringDefinition) => void
  onCancel: () => void
}

/** The create/edit form for a Recurring Cost or a Recurring Income — one
 * form, the side as a value (issues #56, #60; ADR-0011, ADR-0033) — hosted
 * in the modal shell (RecurringDefinitionModal). Fields: Name, Amount, the
 * interval ("Repeats every N days/weeks/months/years" — the unit reads
 * singular when N is 1), and the start date: the first Occurrence, the one
 * date the definition carries (ADR-0024). Left empty at creation it becomes
 * the creation day — so "start today" needs no typing — while editing
 * always shows a date, and an empty one blocks the save: the date can be
 * changed, never unset. Occurrences repeat on the start date's day from
 * there on (29–31 clamp to the last day of shorter months). The Wallet and
 * Category of a linked Transaction are chosen at Transaction creation time,
 * so the definition itself never carries them.
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

/** The form's draft, as submit-and-validate (ADR-0029) sees it: everything
 * that can be wrong, in one flat record, so the pure `validate()` below can
 * judge it without touching React. */
type RecurringDefinitionDraft = {
  name: string
  amount: string
  interval: string
  editing: boolean
  startDate: string
}

/** Submit-and-validate (ADR-0029): the form's pure validation. Returns
 * i18n message IDs keyed by field, under the side's catalog prefix — the
 * form translates them through `formatMessage` before passing to
 * FieldError. Runs on every Save click before any API call; a form with
 * errors submits nothing. Reuses the shared tolerant amount parser from the
 * validation layer (issue #102), never re-implementing it. The interval is
 * a whole number of units: empty, non-integer, or below 1 is one message.
 * The Start date is only mandatory while editing (ADR-0024): at creation
 * an empty one stays allowed — the first Occurrence becomes today. */
function validate(draft: RecurringDefinitionDraft, prefix: string): FieldErrors {
  const errors: FieldErrors = {}
  if (draft.name.trim() === '') {
    errors.name = `${prefix}.validation.nameEmpty`
  }
  const trimmedAmount = draft.amount.trim()
  if (trimmedAmount === '') {
    errors.amount = `${prefix}.validation.amountEmpty`
  } else if (parseAmount(trimmedAmount) === null) {
    errors.amount = /^-?\d+([.,]\d+)?$/.test(trimmedAmount)
      ? `${prefix}.validation.amountNotPositive`
      : `${prefix}.validation.amountInvalid`
  }
  const interval = draft.interval.trim()
  if (interval === '' || !/^\d+$/.test(interval) || Number(interval) < 1) {
    errors.interval = `${prefix}.validation.intervalEmpty`
  }
  if (draft.editing && draft.startDate.trim() === '') {
    errors.start = `${prefix}.validation.startEmpty`
  }
  return errors
}

/** Translate FieldErrors from i18n message IDs to human-readable strings. */
function translateErrors(
  errors: FieldErrors,
  formatMessage: (descriptor: { id: string }) => string,
): FieldErrors {
  const translated: FieldErrors = {}
  for (const [field, key] of Object.entries(errors)) {
    translated[field] = formatMessage({ id: key })
  }
  return translated
}

export function RecurringDefinitionForm({
  side,
  definition,
  onSaved,
  onFreeze,
  onUnfreeze,
  onCancel,
}: RecurringDefinitionFormProps) {
  const { formatMessage } = useIntl()
  const { api, messages, idPrefix } = SIDES[side]
  /** One of the side's form strings. */
  const text = (key: string) => formatMessage({ id: `${messages.form}.${key}` })
  const editing = definition !== undefined
  const readOnly = definition?.frozen === true

  const [name, setName] = useState(definition?.name ?? '')
  const [amount, setAmount] = useState(definition?.amount ?? '')
  const [intervalValue, setIntervalValue] = useState(
    String(definition?.interval_value ?? 1),
  )
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    definition?.interval_unit ?? 'months',
  )
  const [startDate, setStartDate] = useState(definition?.start_date ?? '')
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
  const definitionId = definition?.id
  const occurrencesErrorText = text('occurrencesError')

  // Load the Occurrences section when an existing definition is edited. The
  // rows are the section's own truth: a toggle below replaces them with the
  // refreshed read from the write's response.
  useEffect(() => {
    if (definitionId === undefined) {
      return
    }
    let cancelled = false
    api
      .fetchOccurrences(token, definitionId)
      .then((rows) => {
        if (!cancelled) {
          setOccurrences(rows)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOccurrencesError(occurrencesErrorText)
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, token, definitionId, occurrencesErrorText])

  // One row's Skip/Un-skip (ADR-0026): state the row's skipped state — the
  // response is the refreshed read, so the section swaps its rows in
  // without a second fetch. The write also refreshes the definition's
  // derived state (the cards behind reload on the cache clock, ADR-0022).
  const handleToggleOccurrence = (row: RecurringOccurrence) => {
    if (definitionId === undefined) {
      return
    }
    setTogglingDate(row.date)
    setOccurrencesError(null)
    api
      .setOccurrenceSkipped(token, definitionId, row.date, !row.skipped)
      .then((rows) => setOccurrences(rows))
      .catch(() => setOccurrencesError(text('error.occurrenceUpdate')))
      .finally(() => setTogglingDate(null))
  }

  const intervalNumber = Number.parseInt(intervalValue, 10)

  const buildInput = (): RecurringDefinitionInput => ({
    name: name.trim(),
    amount: (parseAmount(amount) ?? 0).toFixed(2),
    intervalValue: intervalNumber,
    intervalUnit,
    startDate: startDate === '' ? null : startDate,
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fieldErrors = validate(
      { name, amount, interval: intervalValue, editing, startDate },
      messages.form,
    )
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(translateErrors(fieldErrors, formatMessage))
      return
    }
    setErrors({})
    setSubmitting(true)
    setError(null)
    try {
      const saved = editing
        ? await api.update(token, definition.id, buildInput())
        : await api.create(token, buildInput())
      onSaved(saved)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              text('error.conflict'),
              editing ? text('error.save') : text('error.create'),
            )
          : text('error.generic'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleFreeze = async () => {
    if (definition === undefined || definition.frozen) {
      return
    }
    if (!confirmingFreeze) {
      setConfirmingFreeze(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const frozen = await api.freeze(token, definition.id)
      setConfirmingFreeze(false)
      onFreeze?.(frozen)
    } catch {
      setError(text('error.freeze'))
      setSubmitting(false)
    }
  }

  const handleUnfreeze = async () => {
    if (definition === undefined || !definition.frozen) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const unfrozen = await api.unfreeze(token, definition.id)
      onUnfreeze?.(unfrozen)
    } catch {
      setError(text('error.unfreeze'))
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
        {text(editing ? 'title.edit' : 'title.new')}
      </h2>

      <div>
        <label htmlFor={readOnly ? undefined : `${idPrefix}-name`} className="block text-sm font-medium text-slate-700">
          {text('name')}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{name}</p>
        ) : (
          <input
            id={`${idPrefix}-name`}
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={text('namePlaceholder')}
            {...fieldErrorProps('name', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="name" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : `${idPrefix}-amount`} className="block text-sm font-medium text-slate-700">
          {text('amount')}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{amount}</p>
        ) : (
          <input
            id={`${idPrefix}-amount`}
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={text('amountPlaceholder')}
            {...fieldErrorProps('amount', errors)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
          />
        )}
        <FieldError field="amount" errors={errors} />
      </div>

      <div>
        <label htmlFor={readOnly ? undefined : `${idPrefix}-interval`} className="block text-sm font-medium text-slate-700">
          {text('repeatsEvery')}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">
            {intervalText(intervalNumber, intervalUnit)}
          </p>
        ) : (
          <div className="mt-1 flex gap-2">
            <input
              id={`${idPrefix}-interval`}
              type="number"
              min="1"
              step="1"
              required
              value={intervalValue}
              onChange={(event) => setIntervalValue(event.target.value)}
              aria-label={text('everyNAria')}
              {...fieldErrorProps('interval', errors)}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
            />
            <select
              id={`${idPrefix}-unit`}
              value={intervalUnit}
              onChange={(event) => setIntervalUnit(event.target.value as IntervalUnit)}
              aria-label={text('intervalUnitAria')}
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
        <label htmlFor={readOnly ? undefined : `${idPrefix}-start`} className="block text-sm font-medium text-slate-700">
          {text('startDate')}
        </label>
        {readOnly ? (
          <p className="mt-1 text-sm text-slate-900">{startDate}</p>
        ) : (
          <input
            id={`${idPrefix}-start`}
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
          <p className="mt-1 text-xs text-slate-500">{text('startHint')}</p>
        )}
      </div>

      {/* The Occurrences section — hidden for frozen definitions: there
          are no unpaid occurrences to skip. */}
      {editing && !readOnly && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-slate-700">{text('occurrences')}</h3>
          {occurrencesError !== null && (
            <p className="text-sm text-red-600">{occurrencesError}</p>
          )}
          {occurrences === null ? (
            occurrencesError === null && (
              <p className="text-xs text-slate-500">{text('occurrencesLoading')}</p>
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
                        {text('occurrenceSkipped')}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleOccurrence(row)}
                    disabled={togglingDate === row.date}
                    className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  >
                    {row.skipped ? text('unskip') : text('skip')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">{text('occurrenceHelp')}</p>
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
            {submitting ? text('saving') : editing ? text('save') : text('create')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
          >
            {text('cancel')}
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
            {submitting ? text('unfreezing') : text('unfreeze')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
          >
            {text('cancel')}
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
            ? text('freezing')
            : confirmingFreeze
              ? text('freezeConfirm')
              : text('freeze')}
        </button>
      )}
    </form>
  )
}
