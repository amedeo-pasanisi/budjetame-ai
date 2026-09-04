/** Recurring Income form (issue #60): the create/edit form hosted in the
 * modal shell, mirroring the Costs side (issue #56, ADR-0011). The
 * definition's fields are name, amount, "Repeats every N days/weeks/months/
 * years" (the unit reads singular when N is 1), and the start date — the
 * first Occurrence, the one date the definition carries (ADR-0024):
 * optional at creation (empty means today, sent as null), and required when
 * editing (it can be changed, never unset). The API client is mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringIncomeForm } from './RecurringIncomeForm'
import type { RecurringIncome } from './api'

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
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    deleteRecurringIncome: vi.fn(),
    fetchRecurringIncomeOccurrences: vi.fn(),
    setRecurringIncomeOccurrenceSkipped: vi.fn(),
  }
})

import {
  createRecurringIncome,
  deleteRecurringIncome,
  fetchRecurringIncomeOccurrences,
  setRecurringIncomeOccurrenceSkipped,
  updateRecurringIncome,
} from './api'

const createdAt = '2026-08-20T10:00:00Z'

const income: RecurringIncome = {
  id: 1,
  name: 'Salary',
  amount: '2100.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2030-03-15',
  next_due_date: '2030-03-15',
  next_unpaid_occurrence_date: '2030-03-15',
  backlog_count: 0,
  created_at: createdAt,
}

const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const updateRecurringIncomeMock = vi.mocked(updateRecurringIncome)
const deleteRecurringIncomeMock = vi.mocked(deleteRecurringIncome)
const fetchRecurringIncomeOccurrencesMock = vi.mocked(fetchRecurringIncomeOccurrences)
const setRecurringIncomeOccurrenceSkippedMock = vi.mocked(setRecurringIncomeOccurrenceSkipped)

// The Occurrences section's rows (ADR-0026) for the edited definition: the
// next incoming Unpaid row on top, then excused/past rows — newest first.
const occurrences = [
  { date: '2030-04-15', skipped: false },
  { date: '2030-03-15', skipped: true },
]

function renderForm(editing?: RecurringIncome) {
  const onSaved = vi.fn()
  const onDeleted = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <RecurringIncomeForm
      income={editing}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onCancel={onCancel}
    />,
  )
  return { onSaved, onDeleted, onCancel, view }
}

beforeEach(() => {
  createRecurringIncomeMock.mockResolvedValue({ ...income, id: 2 })
  fetchRecurringIncomeOccurrencesMock.mockResolvedValue(occurrences)
})

afterEach(() => {
  vi.clearAllMocks()
})

/** Fill the required fields and submit; returns the payload the mocked
 * create received. */
async function submitCreate() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Freelance' } })
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '800.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create recurring income' }))
  await waitFor(() => expect(createRecurringIncomeMock).toHaveBeenCalled())
  return createRecurringIncomeMock.mock.calls[0][1]
}

describe('RecurringIncomeForm interval copy', () => {
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

describe('RecurringIncomeForm start date', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Create recurring income' }))
    await waitFor(() => expect(createRecurringIncomeMock).toHaveBeenCalledTimes(2))
    expect(createRecurringIncomeMock.mock.calls[1][1]).toMatchObject({
      startDate: '2030-06-01',
    })
  })

  it('is required when editing: clearing it blocks the save', () => {
    renderForm(income)

    const start = screen.getByLabelText('Start date')
    expect(start).toBeRequired()
    expect(start).toHaveValue('2030-03-15')
    expect(
      screen.queryByText('The first occurrence. Leave empty to start today.'),
    ).not.toBeInTheDocument()

    const save = screen.getByRole('button', { name: 'Save' })
    fireEvent.change(start, { target: { value: '' } })
    expect(save).toBeDisabled()
  })
})

describe('RecurringIncomeForm edit and delete', () => {
  it('prefills every field from the income being edited', () => {
    renderForm(income)

    expect(screen.getByLabelText('Name')).toHaveValue('Salary')
    expect(screen.getByLabelText('Amount')).toHaveValue(2100)
    expect(screen.getByLabelText('Every N')).toHaveValue(1)
    expect(screen.getByLabelText('Interval unit')).toHaveValue('months')
    expect(screen.getByLabelText('Start date')).toHaveValue('2030-03-15')
  })

  it('saves edits through updateRecurringIncome with the whole definition', async () => {
    updateRecurringIncomeMock.mockResolvedValue({ ...income, amount: '2200.00' })
    const { onSaved } = renderForm(income)

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateRecurringIncomeMock).toHaveBeenCalled())
    expect(updateRecurringIncomeMock.mock.calls[0][2]).toMatchObject({
      name: 'Salary',
      amount: '2200.00',
      intervalValue: 1,
      intervalUnit: 'months',
      startDate: '2030-03-15',
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('deletes with the tap-again confirmation', async () => {
    deleteRecurringIncomeMock.mockResolvedValue(undefined)
    const { onDeleted } = renderForm(income)

    fireEvent.click(screen.getByRole('button', { name: 'Delete recurring income' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringIncomeMock).toHaveBeenCalledWith('', 1))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(1))
  })

  it('shows the conflict message when the name is taken', async () => {
    const { ApiError } = await import('./api')
    createRecurringIncomeMock.mockRejectedValue(new ApiError('taken', 409))
    renderForm()

    await submitCreate()

    expect(
      await screen.findByText('A recurring income with this name already exists.'),
    ).toBeInTheDocument()
  })

  it('keeps the save disabled until the fields are valid', () => {
    renderForm()
    const save = screen.getByRole('button', { name: 'Create recurring income' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Freelance' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '800.00' } })
    expect(save).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } })
    expect(save).toBeDisabled()
  })
})

describe('RecurringIncomeForm Occurrences section (ADR-0026)', () => {
  /** One occurrence row, found by its date — the row's Skip/Un-skip button
   * lives inside it. */
  const rowFor = (date: string) => screen.getByText(date).closest('li') as HTMLElement

  it('is absent at creation: a definition under creation has no id yet', async () => {
    renderForm()

    expect(screen.queryByRole('heading', { name: 'Occurrences' })).not.toBeInTheDocument()
    expect(fetchRecurringIncomeOccurrencesMock).not.toHaveBeenCalled()
  })

  it('loads the non-Paid rows and renders Skip on live rows, greyed rows with Un-skip', async () => {
    renderForm(income)

    const heading = await screen.findByRole('heading', { name: 'Occurrences' })
    expect(heading).toBeInTheDocument()
    expect(fetchRecurringIncomeOccurrencesMock).toHaveBeenCalledWith('', 1)

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
    setRecurringIncomeOccurrenceSkippedMock.mockResolvedValue([
      { date: '2030-05-15', skipped: false },
      { date: '2030-04-15', skipped: true },
      { date: '2030-03-15', skipped: true },
    ])
    renderForm(income)
    await screen.findByText('2030-04-15')

    fireEvent.click(within(rowFor('2030-04-15')).getByRole('button', { name: 'Skip' }))

    await waitFor(() =>
      expect(setRecurringIncomeOccurrenceSkippedMock).toHaveBeenCalledWith(
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
    setRecurringIncomeOccurrenceSkippedMock.mockResolvedValue([
      { date: '2030-04-15', skipped: false },
      { date: '2030-03-15', skipped: false },
    ])
    renderForm(income)
    await screen.findByText('2030-03-15')

    fireEvent.click(within(rowFor('2030-03-15')).getByRole('button', { name: 'Un-skip' }))

    await waitFor(() =>
      expect(setRecurringIncomeOccurrenceSkippedMock).toHaveBeenCalledWith(
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
    setRecurringIncomeOccurrenceSkippedMock.mockRejectedValue(new Error('down'))
    renderForm(income)
    await screen.findByText('2030-04-15')

    fireEvent.click(within(rowFor('2030-04-15')).getByRole('button', { name: 'Skip' }))

    expect(
      await screen.findByText('Could not update the occurrence.'),
    ).toBeInTheDocument()
    expect(screen.getByText('2030-04-15')).toBeInTheDocument()
  })

  it('shows the read error without blocking the definition save', async () => {
    fetchRecurringIncomeOccurrencesMock.mockRejectedValue(new Error('down'))
    updateRecurringIncomeMock.mockResolvedValue({ ...income, amount: '2200.00' })
    const { onSaved } = renderForm(income)

    expect(
      await screen.findByText('Could not load the occurrences.'),
    ).toBeInTheDocument()

    // The definition fields still work: the section's own failure never
    // takes the form down.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})
