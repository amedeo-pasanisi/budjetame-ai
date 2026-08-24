/** Recurring Income form (issue #60): the create/edit form hosted in the
 * modal shell, mirroring the Costs side (issue #56, ADR-0011). The due-date
 * override follows the interval unit — a day-of-month for months, a month+day
 * pair for years, nothing for days/weeks — and an unset start date is sent
 * as null (the creation date is used). The API client is mocked. */
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
  due_day: 1,
  due_month: null,
  next_due_date: '2030-03-01',

  next_unpaid_occurrence_date: '2030-03-01',
  backlog_count: 0,
  overdue: false,
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

describe('RecurringIncomeForm due-date override', () => {
  it('months offer a due day; days and weeks offer nothing', () => {
    renderForm()

    expect(screen.getByLabelText('Due day (optional)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Due month')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Interval unit'), { target: { value: 'days' } })
    expect(screen.queryByLabelText('Due day (optional)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Due month')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Interval unit'), { target: { value: 'weeks' } })
    expect(screen.queryByLabelText('Due day (optional)')).not.toBeInTheDocument()
  })

  it('years offer a month+day pair, and half a pair blocks the save', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Interval unit'), { target: { value: 'years' } })

    const dueMonth = screen.getByLabelText('Due month')
    const dueDay = screen.getByLabelText('Due day')
    // Month alone: the helper warns and the save stays disabled.
    fireEvent.change(dueMonth, { target: { value: '12' } })
    expect(screen.getByText('Pick both the month and the day, or leave both unset.')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Create recurring income' })
    expect(save).toBeDisabled()

    // The complete pair unblocks the save once the required fields are
    // filled, and the month+day reach the payload.
    fireEvent.change(dueDay, { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bonus' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1500.00' } })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    await waitFor(() => expect(createRecurringIncomeMock).toHaveBeenCalled())
    expect(createRecurringIncomeMock.mock.calls[0][1]).toMatchObject({
      intervalUnit: 'years',
      dueDay: 1,
      dueMonth: 12,
    })
  })

  it('an unset start date is sent as null and a month due day as a number', async () => {
    renderForm()
    const payload = await submitCreate()
    expect(payload).toMatchObject({
      startDate: null,
      intervalUnit: 'months',
      dueDay: null,
      dueMonth: null,
    })

    // Setting the due day reaches the payload without a month.
    fireEvent.change(screen.getByLabelText('Due day (optional)'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create recurring income' }))
    await waitFor(() => expect(createRecurringIncomeMock).toHaveBeenCalledTimes(2))
    expect(createRecurringIncomeMock.mock.calls[1][1]).toMatchObject({
      dueDay: 15,
      dueMonth: null,
    })
  })

  it('switching months to days drops the override from the payload', async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Due day (optional)'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Interval unit'), { target: { value: 'days' } })

    const payload = await submitCreate()
    expect(payload).toMatchObject({ intervalUnit: 'days', dueDay: null, dueMonth: null })
  })
})

describe('RecurringIncomeForm edit and delete', () => {
  it('prefills every field from the income being edited', () => {
    renderForm(income)

    expect(screen.getByLabelText('Name')).toHaveValue('Salary')
    expect(screen.getByLabelText('Amount')).toHaveValue(2100)
    expect(screen.getByLabelText('Every N')).toHaveValue(1)
    expect(screen.getByLabelText('Interval unit')).toHaveValue('months')
    expect(screen.getByLabelText('Start date (optional)')).toHaveValue('2030-03-15')
    expect(screen.getByLabelText('Due day (optional)')).toHaveValue('1')
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
      dueDay: 1,
      dueMonth: null,
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
