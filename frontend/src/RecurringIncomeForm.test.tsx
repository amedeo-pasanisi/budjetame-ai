/** Recurring Income form (issue #60): the create/edit form hosted in the
 * modal shell, mirroring the Costs side (issue #56, ADR-0011). The
 * definition's fields are name, amount, "Repeats every N days/weeks/months/
 * years" (the unit reads singular when N is 1), and the start date — the
 * first Occurrence, the one date the definition carries (ADR-0024):
 * optional at creation (empty means today, sent as null), and required when
 * editing (it can be changed, never unset). The API client is mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
  }
})

import { createRecurringIncome, deleteRecurringIncome, updateRecurringIncome } from './api'

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
  next_skip_action: 'skip',
  created_at: createdAt,
}

const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const updateRecurringIncomeMock = vi.mocked(updateRecurringIncome)
const deleteRecurringIncomeMock = vi.mocked(deleteRecurringIncome)

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
