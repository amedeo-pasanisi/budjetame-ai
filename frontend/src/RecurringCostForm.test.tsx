/** Recurring Cost form (issue #56): the create/edit form hosted in the modal
 * shell. The definition's fields are name, amount, "Repeats every N
 * days/weeks/months/years" (the unit reads singular when N is 1), and the
 * start date — the first Occurrence, the one date the definition carries
 * (ADR-0024): optional at creation (empty means today, sent as null), and
 * required when editing (it can be changed, never unset). Validation is
 * submit-and-validate (ADR-0029): Save is always clickable and an invalid
 * draft reveals a Field Error under each wrong field instead of calling the
 * API. The API client is mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringCostForm } from './RecurringCostForm'
import type { RecurringCost } from './api'

vi.mock('./api', async () => {
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    TOKEN_KEY: 'budjetame.token',
    ApiError,
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError
        ? error.status === 409
          ? conflict
          : fallback
        : fallback,
    createRecurringCost: vi.fn(),
    updateRecurringCost: vi.fn(),
    freezeRecurringCost: vi.fn(),
    unfreezeRecurringCost: vi.fn(),
    fetchRecurringCostOccurrences: vi.fn(),
    setRecurringCostOccurrenceSkipped: vi.fn(),
  }
})

import {
  createRecurringCost,
  freezeRecurringCost,
  unfreezeRecurringCost,
  fetchRecurringCostOccurrences,
  setRecurringCostOccurrenceSkipped,
  updateRecurringCost,
} from './api'

const createdAt = '2026-08-19T10:00:00Z'

const cost: RecurringCost = {
  id: 1,
  name: 'Rent',
  amount: '850.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2030-03-15',
  next_due_date: '2030-03-15',
  next_unpaid_occurrence_date: '2030-03-15',
  backlog_count: 0,
  frozen: false,
  created_at: createdAt,
}

const frozenCost: RecurringCost = {
  id: 2,
  name: 'Old Netflix',
  amount: '15.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2025-01-01',
  next_due_date: null,
  next_unpaid_occurrence_date: null,
  backlog_count: 0,
  frozen: true,
  created_at: createdAt,
}

const createRecurringCostMock = vi.mocked(createRecurringCost)
const updateRecurringCostMock = vi.mocked(updateRecurringCost)
const freezeRecurringCostMock = vi.mocked(freezeRecurringCost)
const unfreezeRecurringCostMock = vi.mocked(unfreezeRecurringCost)
const fetchRecurringCostOccurrencesMock = vi.mocked(fetchRecurringCostOccurrences)
const setRecurringCostOccurrenceSkippedMock = vi.mocked(setRecurringCostOccurrenceSkipped)

// The Occurrences section's rows (ADR-0026) for the edited definition: the
// next incoming Unpaid row on top, then excused/past rows — newest first.
const occurrences = [
  { date: '2030-04-15', skipped: false },
  { date: '2030-03-15', skipped: true },
]

function renderForm(editing?: RecurringCost) {
  const onSaved = vi.fn()
  const onFreeze = vi.fn()
  const onUnfreeze = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <RecurringCostForm
      cost={editing}
      onSaved={onSaved}
      onFreeze={onFreeze}
      onUnfreeze={onUnfreeze}
      onCancel={onCancel}
    />,
  )
  return { onSaved, onFreeze, onUnfreeze, onCancel, view }
}

beforeEach(() => {
  createRecurringCostMock.mockResolvedValue({ ...cost, id: 2 })
  fetchRecurringCostOccurrencesMock.mockResolvedValue(occurrences)
})

afterEach(() => {
  vi.clearAllMocks()
})

/** One occurrence row, found by its date — the row's Skip/Un-skip button
 * lives inside it. */
const rowFor = (date: string) => screen.getByText(date).closest('li') as HTMLElement

/** Fill the required fields and submit; returns the payload the mocked
 * create received. */
async function submitCreate() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create recurring cost' }))
  await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalled())
  return createRecurringCostMock.mock.calls[0][1]
}

describe('RecurringCostForm interval copy', () => {
  it('labels the row "Repeats every" and reads the unit singular for 1', () => {
    renderForm()

    expect(screen.getByLabelText('Repeats every')).toBeInTheDocument()
    const unit = screen.getByLabelText('Interval unit') as HTMLSelectElement
    expect(unit.value).toBe('months')
    expect(unit.options[2].textContent).toBe('Month')

    // Every 2 flips the unit to the plural.
    fireEvent.change(screen.getByLabelText('Every N'), { target: { value: '2' } })
    expect(unit.options[2].textContent).toBe('Months')
    expect(unit.options[3].textContent).toBe('Years')
  })
})

describe('RecurringCostForm start date', () => {
  it('is optional at creation: empty means today (sent as null)', async () => {
    renderForm()
    const start = screen.getByLabelText('Start date')
    expect(start).not.toBeRequired()
    expect(
      screen.getByText('The first occurrence. Leave empty to start today.'),
    ).toBeInTheDocument()

    const payload = await submitCreate()
    expect(payload).toMatchObject({
      startDate: null,
      intervalUnit: 'months',
    })

    // A chosen date reaches the payload as-is.
    fireEvent.change(start, { target: { value: '2030-06-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create recurring cost' }))
    await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalledTimes(2))
    expect(createRecurringCostMock.mock.calls[1][1]).toMatchObject({
      startDate: '2030-06-01',
    })
  })

  it('is required when editing: clearing it reveals "Choose a start date" on Save', () => {
    renderForm(cost)

    const start = screen.getByLabelText('Start date')
    expect(start).toBeRequired()
    expect(start).toHaveValue('2030-03-15')
    expect(
      screen.queryByText('The first occurrence. Leave empty to start today.'),
    ).not.toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'Save' })
    fireEvent.change(start, { target: { value: '' } })
    // Submit-and-validate (ADR-0029): clearing the date never disables the
    // button — Save reveals the Start-date Field Error instead.
    expect(save).toBeEnabled()
    fireEvent.click(save)
    expect(screen.getByText('Choose a start date')).toBeInTheDocument()
    expect(updateRecurringCostMock).not.toHaveBeenCalled()
  })
})

describe('RecurringCostForm edit and freeze', () => {
  it('prefills every field from the cost being edited', () => {
    renderForm(cost)

    expect(screen.getByLabelText('Name')).toHaveValue('Rent')
    expect(screen.getByLabelText('Amount')).toHaveValue('850.00')
    expect(screen.getByLabelText('Every N')).toHaveValue(1)
    expect(screen.getByLabelText('Interval unit')).toHaveValue('months')
    expect(screen.getByLabelText('Start date')).toHaveValue('2030-03-15')
  })

  it('saves edits through updateRecurringCost with the whole definition', async () => {
    updateRecurringCostMock.mockResolvedValue({ ...cost, amount: '900.00' })
    const { onSaved } = renderForm(cost)

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateRecurringCostMock).toHaveBeenCalled())
    expect(updateRecurringCostMock.mock.calls[0][2]).toMatchObject({
      name: 'Rent',
      amount: '900.00',
      intervalValue: 1,
      intervalUnit: 'months',
      startDate: '2030-03-15',
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('freezes with the tap-again confirmation', async () => {
    freezeRecurringCostMock.mockResolvedValue({ ...cost, frozen: true })
    const { onFreeze } = renderForm(cost)

    fireEvent.click(screen.getByRole('button', { name: 'Freeze recurring cost' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm freeze' }))

    await waitFor(() =>
      expect(freezeRecurringCostMock).toHaveBeenCalledWith('', 1),
    )
    await waitFor(() => expect(onFreeze).toHaveBeenCalled())
  })

  it('shows unfreeze button for a frozen cost', async () => {
    unfreezeRecurringCostMock.mockResolvedValue({ ...frozenCost, frozen: false })
    const { onUnfreeze } = renderForm(frozenCost)

    expect(
      screen.getByRole('button', { name: 'Unfreeze recurring cost' }),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Unfreeze recurring cost' }),
    )

    await waitFor(() =>
      expect(unfreezeRecurringCostMock).toHaveBeenCalledWith('', 2),
    )
    await waitFor(() => expect(onUnfreeze).toHaveBeenCalled())
  })

  it('shows the conflict message when the name is taken', async () => {
    const { ApiError } = await import('./api')
    createRecurringCostMock.mockRejectedValue(new ApiError('taken', 409))
    renderForm()

    await submitCreate()

    expect(
      await screen.findByText('A recurring cost with this name already exists.'),
    ).toBeInTheDocument()
    // Server rejections keep the form-level banner and never become Field
    // Errors (ADR-0029) — the two error kinds never mix.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('RecurringCostForm submit-and-validate (ADR-0029, issue #104)', () => {
  const createButton = () => screen.getByRole('button', { name: 'Create recurring cost' })
  const saveButton = () => screen.getByRole('button', { name: 'Save' })

  it('leaves Save clickable on an invalid draft, reveals every Field Error at once, and calls no API', () => {
    renderForm()

    // Save is never disabled for validation (ADR-0029): an invalid draft
    // stays clickable so its errors can be discovered.
    expect(createButton()).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Every N'), { target: { value: '0' } })
    fireEvent.click(createButton())

    // One Field Error per wrong field, all at once: empty Name, empty
    // Amount, and an interval below 1.
    expect(screen.getByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount')).toBeInTheDocument()
    expect(screen.getByText('The interval must be at least 1')).toBeInTheDocument()
    // The invalid submit reached the API never.
    expect(createRecurringCostMock).not.toHaveBeenCalled()
    // The browser's own validation voice is off: Field Errors are the only
    // ones.
    expect(document.querySelector('form')).toHaveAttribute('novalidate')
  })

  it('reveals the Amount messages by kind: empty, unparseable, non-positive', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })

    fireEvent.click(createButton())
    expect(screen.getByText('Enter an amount')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: 'abc' } })
    fireEvent.click(createButton())
    expect(
      screen.getByText(
        "That doesn't look like an amount — use digits and one . or , for decimals",
      ),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } })
    fireEvent.click(createButton())
    expect(screen.getByText('Amount must be a positive number')).toBeInTheDocument()
    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })

  it('an error rides the Amount field\'s aria wiring, and the input is a tolerant text field', () => {
    renderForm()

    const amount = screen.getByLabelText('Amount') as HTMLInputElement
    // The Amount Input contract (ADR-0029): a text field — not the
    // browser-owned type="number" that swallowed dots in comma-locales.
    expect(amount).toHaveAttribute('type', 'text')
    expect(amount).toHaveAttribute('inputmode', 'decimal')

    fireEvent.click(createButton())

    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(amount).toHaveAttribute('aria-describedby', 'amount-error')
    // The alert is the element the input's aria-describedby points at — a
    // screen reader reads the message with its field.
    expect(document.getElementById('amount-error')).toHaveTextContent('Enter an amount')
  })

  it('keeps every Field Error while the user types the fix, clearing only on the next Save', async () => {
    renderForm()
    fireEvent.click(createButton())
    expect(screen.getByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount')).toBeInTheDocument()

    // Fixing the fields changes nothing on screen (ADR-0029): errors
    // refresh only on the next Save attempt.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.00' } })
    expect(screen.getByText('Enter a name')).toBeInTheDocument()
    expect(screen.getByText('Enter an amount')).toBeInTheDocument()

    // The next Save attempt clears them and proceeds exactly as before.
    fireEvent.click(createButton())
    await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalled())
    expect(createRecurringCostMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ name: 'Gym', amount: '45.00' }),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts a tolerant Amount Input through the real UI, saving the canonical value', async () => {
    renderForm()

    // 1.000,45 is Italian grouping + comma decimals: the shared parser
    // (ADR-0029) reads 1000.45, and the create submits the canonical cents
    // the backend's Decimal expects.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1.000,45' } })
    fireEvent.click(createButton())

    await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalled())
    expect(createRecurringCostMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ amount: '1000.45' }),
    )
  })

  it('rejects an interval below 1 with its message, and a fixed interval saves', async () => {
    renderForm()
    const everyN = screen.getByLabelText('Every N')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.00' } })

    // Zero and empty (user story #26 in the umbrella): the same message.
    for (const bad of ['0', '']) {
      fireEvent.change(everyN, { target: { value: bad } })
      fireEvent.click(createButton())
      expect(screen.getByText('The interval must be at least 1')).toBeInTheDocument()
      expect(createRecurringCostMock).not.toHaveBeenCalled()
    }

    fireEvent.change(everyN, { target: { value: '3' } })
    fireEvent.click(createButton())
    await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalled())
    expect(createRecurringCostMock).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ intervalValue: 3 }),
    )
  })

  it('editing: a cleared Start date reveals "Choose a start date", restoring it saves', async () => {
    updateRecurringCostMock.mockResolvedValue({ ...cost })
    renderForm(cost)

    const start = screen.getByLabelText('Start date')
    fireEvent.change(start, { target: { value: '' } })
    fireEvent.click(saveButton())
    expect(screen.getByText('Choose a start date')).toBeInTheDocument()
    expect(updateRecurringCostMock).not.toHaveBeenCalled()

    // The date can be changed, never unset (ADR-0024): the next Save with
    // a date rides to the API exactly as before.
    fireEvent.change(start, { target: { value: '2030-03-15' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(updateRecurringCostMock).toHaveBeenCalled())
    expect(screen.queryByText('Choose a start date')).not.toBeInTheDocument()
  })

  it('frozen records render read-only with no Save button — validation never applies', () => {
    renderForm(frozenCost)

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create recurring cost' })).not.toBeInTheDocument()
    expect(screen.getByText('Old Netflix')).toBeInTheDocument()
    // The frozen rendering is pure text: no field ever carries an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables Save only while an Occurrence Skip/Un-skip toggle is in flight', async () => {
    let resolveToggle!: (rows: { date: string; skipped: boolean }[]) => void
    setRecurringCostOccurrenceSkippedMock.mockReturnValue(
      new Promise<{ date: string; skipped: boolean }[]>((resolve) => {
        resolveToggle = resolve
      }),
    )
    renderForm(cost)
    await screen.findByText('2030-04-15')

    fireEvent.click(within(rowFor('2030-04-15')).getByRole('button', { name: 'Skip' }))

    // In-flight work disables Save (ADR-0029)…
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await act(async () => {
      resolveToggle([
        { date: '2030-05-15', skipped: false },
        { date: '2030-04-15', skipped: true },
        { date: '2030-03-15', skipped: true },
      ])
    })

    // …and the completed write restores it.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

describe('RecurringCostForm Occurrences section (ADR-0026)', () => {
  it('is absent at creation: a definition under creation has no id yet', async () => {
    renderForm()

    expect(screen.queryByRole('heading', { name: 'Occurrences' })).not.toBeInTheDocument()
    expect(fetchRecurringCostOccurrencesMock).not.toHaveBeenCalled()
  })

  it('loads the non-Paid rows and renders Skip on live rows, greyed rows with Un-skip', async () => {
    renderForm(cost)

    const heading = await screen.findByRole('heading', { name: 'Occurrences' })
    expect(heading).toBeInTheDocument()
    expect(fetchRecurringCostOccurrencesMock).toHaveBeenCalledWith('', 1)

    // The next incoming Unpaid row is live (Skip); the excused past row
    // stays greyed with Un-skip and a Skipped caption.
    const live = rowFor('2030-04-15')
    expect(within(live).getByRole('button', { name: 'Skip' })).toBeInTheDocument()
    expect(within(live).queryByText(/Skipped/)).not.toBeInTheDocument()

    const skipped = rowFor('2030-03-15')
    expect(within(skipped).getByRole('button', { name: 'Un-skip' })).toBeInTheDocument()
    expect(within(skipped).getByText('Skipped — un-skip to pay it')).toBeInTheDocument()
  })

  it('skipping the live row excuses it and swaps in the refreshed read', async () => {
    setRecurringCostOccurrenceSkippedMock.mockResolvedValue([
      { date: '2030-05-15', skipped: false },
      { date: '2030-04-15', skipped: true },
      { date: '2030-03-15', skipped: true },
    ])
    renderForm(cost)
    await screen.findByText('2030-04-15')

    fireEvent.click(within(rowFor('2030-04-15')).getByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(setRecurringCostOccurrenceSkippedMock).toHaveBeenCalledWith(
        '',
        1,
        '2030-04-15',
        true,
      ),
    )
    // The write's response is the refreshed read: the excused row greys and
    // the following incoming one surfaces above it.
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0].textContent).toContain('2030-05-15')
    expect(within(rowFor('2030-04-15')).getByRole('button', { name: 'Un-skip' })).toBeInTheDocument()
  })

  it('un-skipping restores the row (write with skipped false)', async () => {
    setRecurringCostOccurrenceSkippedMock.mockResolvedValue([
      { date: '2030-04-15', skipped: false },
      { date: '2030-03-15', skipped: false },
    ])
    renderForm(cost)
    await screen.findByText('2030-03-15')

    fireEvent.click(within(rowFor('2030-03-15')).getByRole('button', { name: 'Un-skip' }))

    await waitFor(() =>
      expect(setRecurringCostOccurrenceSkippedMock).toHaveBeenCalledWith(
        '',
        1,
        '2030-03-15',
        false,
      ),
    )
    await waitFor(() =>
      expect(within(rowFor('2030-03-15')).getByRole('button', { name: 'Skip' })).toBeInTheDocument(),
    )
    expect(screen.queryByText('Skipped — un-skip to pay it')).not.toBeInTheDocument()
  })

  it('shows the error and keeps the rows when a toggle fails', async () => {
    setRecurringCostOccurrenceSkippedMock.mockRejectedValue(new Error('down'))
    renderForm(cost)
    await screen.findByText('2030-04-15')

    fireEvent.click(within(rowFor('2030-04-15')).getByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Could not update the occurrence.'),
    ).toBeInTheDocument()
    expect(screen.getByText('2030-04-15')).toBeInTheDocument()
  })

  it('shows the read error without blocking the definition save', async () => {
    fetchRecurringCostOccurrencesMock.mockRejectedValue(new Error('down'))
    updateRecurringCostMock.mockResolvedValue({ ...cost, amount: '900.00' })
    const { onSaved } = renderForm(cost)

    expect(
      await screen.findByText('Could not load the occurrences.'),
    ).toBeInTheDocument()

    // The definition fields still work: the section's own failure never
    // takes the form down.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
