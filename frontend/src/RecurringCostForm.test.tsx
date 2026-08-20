/** Recurring Cost form (issue #56): the create/edit form hosted in the modal
 * shell. The due-date override follows the interval unit — a day-of-month
 * for months, a month+day pair for years, nothing for days/weeks — and an
 * unset start date is sent as null (the creation date is used). The API
 * client is mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { RecurringCostForm } from './RecurringCostForm'
import type { Category, RecurringCost, Wallet } from './api'

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
    deleteRecurringCost: vi.fn(),
  }
})

import { createRecurringCost, deleteRecurringCost, updateRecurringCost } from './api'

const createdAt = '2026-08-19T10:00:00Z'

const wallets: Wallet[] = [
  { id: 1, name: 'Intesa', type: 'checking', balance: '0.00', frozen: false, created_at: createdAt },
]

const categories: Category[] = [
  { id: 1, name: 'Housing', type: 'expense', icon: null, color: '#ef4444', created_at: createdAt },
  { id: 2, name: 'Salary', type: 'income', icon: null, color: '#10b981', created_at: createdAt },
]

const cost: RecurringCost = {
  id: 1,
  name: 'Rent',
  amount: '850.00',
  wallet_id: 1,
  category_id: 1,
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2030-03-15',
  due_day: 1,
  due_month: null,
  next_due_date: '2030-03-01',
  next_unpaid_occurrence_date: '2030-03-15',
  backlog_count: 0,
  overdue: false,
  created_at: createdAt,
}

const createRecurringCostMock = vi.mocked(createRecurringCost)
const updateRecurringCostMock = vi.mocked(updateRecurringCost)
const deleteRecurringCostMock = vi.mocked(deleteRecurringCost)

function renderForm(editing?: RecurringCost) {
  const onSaved = vi.fn()
  const onDeleted = vi.fn()
  const onCancel = vi.fn()
  const onAddCategory = vi.fn()
  const view = render(
    <RecurringCostForm
      cost={editing}
      wallets={wallets}
      categories={categories}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onCancel={onCancel}
      onAddCategory={onAddCategory}
      categoryToSelect={null}
    />,
  )
  return { onSaved, onDeleted, onCancel, onAddCategory, view }
}

beforeEach(() => {
  createRecurringCostMock.mockResolvedValue({ ...cost, id: 2 })
})

afterEach(() => {
  vi.clearAllMocks()
})

/** Fill the required fields and submit; returns the payload the mocked
 * create received. */
async function submitCreate() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create recurring cost' }))
  await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalled())
  return createRecurringCostMock.mock.calls[0][1]
}

describe('RecurringCostForm due-date override', () => {
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
    const save = screen.getByRole('button', { name: 'Create recurring cost' })
    expect(save).toBeDisabled()

    // The complete pair unblocks the save once the required fields are
    // filled, and the month+day reach the payload.
    fireEvent.change(dueDay, { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Insurance' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '120.00' } })
    expect(save).not.toBeDisabled()
    fireEvent.click(save)
    await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalled())
    expect(createRecurringCostMock.mock.calls[0][1]).toMatchObject({
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
    fireEvent.click(screen.getByRole('button', { name: 'Create recurring cost' }))
    await waitFor(() => expect(createRecurringCostMock).toHaveBeenCalledTimes(2))
    expect(createRecurringCostMock.mock.calls[1][1]).toMatchObject({
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

describe('RecurringCostForm edit and delete', () => {
  it('prefills every field from the cost being edited', () => {
    renderForm(cost)

    expect(screen.getByLabelText('Name')).toHaveValue('Rent')
    expect(screen.getByLabelText('Amount')).toHaveValue(850)
    expect(screen.getByLabelText('Wallet')).toHaveValue('1')
    expect(screen.getByLabelText('Category (optional)')).toHaveValue('1')
    expect(screen.getByLabelText('Every N')).toHaveValue(1)
    expect(screen.getByLabelText('Interval unit')).toHaveValue('months')
    expect(screen.getByLabelText('Start date (optional)')).toHaveValue('2030-03-15')
    expect(screen.getByLabelText('Due day (optional)')).toHaveValue('1')
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
      walletId: 1,
      categoryId: 1,
      intervalValue: 1,
      intervalUnit: 'months',
      startDate: '2030-03-15',
      dueDay: 1,
      dueMonth: null,
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('deletes with the tap-again confirmation', async () => {
    deleteRecurringCostMock.mockResolvedValue(undefined)
    const { onDeleted } = renderForm(cost)

    fireEvent.click(screen.getByRole('button', { name: 'Delete recurring cost' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringCostMock).toHaveBeenCalledWith('', 1))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(1))
  })

  it('shows the conflict message when the name is taken', async () => {
    const { ApiError } = await import('./api')
    createRecurringCostMock.mockRejectedValue(new ApiError('taken', 409))
    renderForm()

    await submitCreate()

    expect(
      await screen.findByText('A recurring cost with this name already exists.'),
    ).toBeInTheDocument()
  })

  it('keeps the save disabled until the fields are valid', () => {
    renderForm()
    const save = screen.getByRole('button', { name: 'Create recurring cost' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '45.00' } })
    expect(save).not.toBeDisabled()

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } })
    expect(save).toBeDisabled()
  })
})
