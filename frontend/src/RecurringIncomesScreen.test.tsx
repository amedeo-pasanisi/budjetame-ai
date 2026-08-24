/** Recurring Incomes screen (issue #60): the Incomes side of the Recurring
 * tab renders every income sorted by next due date, each row showing name,
 * amount, interval, and the next due date (derived on the backend, override
 * applied); the Backlog badge, the Overdue mark, and the summary line (issue
 * #62) ride on the API's derived state. Create, edit, and delete live in a
 * modal on this screen, mirroring the Costs side (ADR-0011). The API client
 * is mocked; the real display helpers (interval text, euro formatting) stay
 * live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringIncomesScreen } from './RecurringIncomesScreen'
import type { RecurringIncome } from './api'

vi.mock('./api', async () => {
  const { formatEuros, formatSignedEuros } = await import('./api/format')
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
    formatEuros,
    formatSignedEuros,
    fetchRecurringIncomes: vi.fn(),
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    deleteRecurringIncome: vi.fn(),
    toggleSkipRecurringIncome: vi.fn(),
  }
})

import {
  ApiError,
  createRecurringIncome,
  deleteRecurringIncome,
  fetchRecurringIncomes,
  toggleSkipRecurringIncome,
  updateRecurringIncome,
} from './api'

const createdAt = '2026-08-20T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const incomes: RecurringIncome[] = [
  {
    id: 1,
    name: 'Salary',
    amount: '2100.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 27,
    due_month: null,
    next_due_date: '2026-09-27',
    next_unpaid_occurrence_date: '2026-09-27',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'skip',
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Rent from Marco',
    amount: '600.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 1,
    due_month: null,
    next_due_date: '2026-09-01',
    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 3,
    overdue: true,
    next_skip_action: 'skip',
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Bonus',
    amount: '1500.00',
    interval_value: 1,
    interval_unit: 'years',
    start_date: null,
    due_day: 1,
    due_month: 12,
    next_due_date: '2026-12-01',
    next_unpaid_occurrence_date: '2026-12-01',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'unskip',
    created_at: createdAt,
  },
]

const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)
const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const updateRecurringIncomeMock = vi.mocked(updateRecurringIncome)
const deleteRecurringIncomeMock = vi.mocked(deleteRecurringIncome)
const toggleSkipRecurringIncomeMock = vi.mocked(toggleSkipRecurringIncome)

beforeEach(() => {
  fetchRecurringIncomesMock.mockResolvedValue(incomes)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringIncomesScreen rows', () => {
  it('renders every income sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Rent from Marco'),
      expect.stringContaining('Salary'),
      expect.stringContaining('Bonus'),
    ])
    // Each row shows the amount and the interval with the next due date.
    const texts = rows.map((row) => row.textContent ?? '')
    expect(texts[0]).toContain('€600.00')
    expect(texts[0]).toContain('Every month · next due 2026-09-01')
    expect(texts[1]).toContain('€2100.00')
    expect(texts[1]).toContain('Every month · next due 2026-09-27')
    expect(texts[2]).toContain('€1500.00')
    expect(texts[2]).toContain('Every year · next due 2026-12-01')
  })

  it('keeps the empty state when there are no incomes', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([])
    render(<RecurringIncomesScreen />)

    expect(
      await screen.findByText("No recurring incomes yet. Add your first one to track what's due."),
    ).toBeInTheDocument()
  })

  it('shows the load error when the list cannot be fetched', async () => {
    fetchRecurringIncomesMock.mockRejectedValue(new Error('down'))
    render(<RecurringIncomesScreen />)

    expect(
      await screen.findByText('Could not load your recurring incomes.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringIncomesScreen create flow', () => {
  it('creates an income from the modal and lands it at its sorted position', async () => {
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Freelance',
      amount: '800.00',
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
      overdue: true,
      next_skip_action: 'skip',
      created_at: createdAt,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '800.00' } })
    fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
      target: { value: 'weeks' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))

    await waitFor(() =>
      expect(createRecurringIncomeMock).toHaveBeenCalledWith('', {
        name: 'Freelance',
        amount: '800.00',
        intervalValue: 1,
        intervalUnit: 'weeks',
        startDate: null,
        dueDay: null,
        dueMonth: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
      .map((row) => row.textContent)
    expect(rows[0]).toContain('Freelance')
  })

  it('shows the validation error when the API rejects the create', async () => {
    createRecurringIncomeMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Salary' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '800.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))

    expect(
      await within(dialog).findByText('A recurring income with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open with the draft intact.
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Salary')
  })
})

describe('RecurringIncomesScreen edit and delete flows', () => {
  it('edits an income from its row and keeps it in the sorted list', async () => {
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      next_due_date: '2026-09-27',
      next_unpaid_occurrence_date: '2026-09-27',
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Salary')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(2100)

    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ name: 'Salary', amount: '2200.00' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const salaryRow = screen
      .getAllByRole('button')
      .find((row) => row.textContent?.includes('Salary'))
    expect(salaryRow?.textContent).toContain('€2200.00')
  })

  it('deletes an income with the tap-again confirmation', async () => {
    deleteRecurringIncomeMock.mockResolvedValue(undefined)
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Bonus')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recurring income' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringIncomeMock).toHaveBeenCalledWith('', 3))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Bonus')).not.toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const third = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
  })
})

describe('RecurringIncomesScreen skip button', () => {
  it('renders Skip or Un-skip per the API state, and keeps the card clickable', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    // Salary and Marco have an unskipped next occurrence: Skip. Bonus has
    // nothing left to skip: Un-skip.
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Un-skip' })).toBeInTheDocument()
    // The card itself still opens the edit modal.
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    expect(
      await screen.findByRole('dialog', { name: 'Edit recurring income' }),
    ).toBeInTheDocument()
  })

  it('skips the next occurrence and swaps in the returned state', async () => {
    toggleSkipRecurringIncomeMock.mockResolvedValue({
      ...incomes[1],
      backlog_count: 0,
      overdue: false,
      next_skip_action: 'unskip',
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const skipButtons = screen.getAllByRole('button', { name: 'Skip' })
    fireEvent.click(
      skipButtons.find(
        (button) => button.closest('li')?.textContent?.includes('Rent from Marco'),
      ) as HTMLElement,
    )

    await waitFor(() =>
      expect(toggleSkipRecurringIncomeMock).toHaveBeenCalledWith('', 2),
    )
    // The returned state re-renders the card: no badge, no Overdue mark,
    // the button now reads Un-skip (Marco joins Bonus), and the summary
    // re-totals.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Un-skip' })).toHaveLength(2)
    })
    const marco = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
      .find((row) => row.textContent?.includes('Rent from Marco'))
    expect(marco?.textContent).not.toContain('unpaid')
    expect(marco?.textContent).not.toContain('Overdue')
    expect(
      screen.getByText('0 incomes overdue · 0 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('shows the error message when the toggle fails', async () => {
    toggleSkipRecurringIncomeMock.mockRejectedValue(new Error('down'))
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip' })[0])

    expect(
      await screen.findByText('Could not update your recurring incomes.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringIncomesScreen backlog, Overdue, and the summary line', () => {
  /** The row buttons, in screen order — the badge and the Overdue mark live
   * inside them. */
  const rowButtons = () =>
    screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))

  it('shows the summary line with the overdue and unpaid totals', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    expect(
      screen.getByText('1 income overdue · 3 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('renders the badge and the Overdue mark only on an income with a Backlog', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const marco = rowButtons().find((row) => row.textContent?.includes('Rent from Marco'))
    expect(marco?.textContent).toContain('3 unpaid')
    expect(marco?.textContent).toContain('Overdue')

    // Salary and Bonus have no Backlog: no badge, no Overdue mark.
    const salary = rowButtons().find((row) => row.textContent?.includes('Salary'))
    expect(salary?.textContent).not.toContain('unpaid')
    expect(salary?.textContent).not.toContain('Overdue')
  })

  it('uses singular wording for one overdue income and one unpaid occurrence', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([
      { ...incomes[1], backlog_count: 1, overdue: true },
    ])
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    expect(
      screen.getByText('1 income overdue · 1 unpaid occurrence'),
    ).toBeInTheDocument()
  })

  it('shows zero totals when nothing is behind, and hides the line when there are no incomes', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([
      { ...incomes[0], backlog_count: 0, overdue: false },
    ])
    render(<RecurringIncomesScreen />)
    await screen.findByText('Salary')

    expect(
      screen.getByText('0 incomes overdue · 0 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('updates the badge, the mark, and the summary after a definition edit', async () => {
    // The edited income comes back with the fresh derived state: a changed
    // start date pushed two Occurrences behind it.
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      backlog_count: 2,
      overdue: true,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = rowButtons()
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const salary = rowButtons().find((row) => row.textContent?.includes('Salary'))
    expect(salary?.textContent).toContain('2 unpaid')
    expect(salary?.textContent).toContain('Overdue')
    // The summary re-totals from the returned state: Salary joined Marco.
    expect(
      screen.getByText('2 incomes overdue · 5 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('shows the badge and the Overdue mark on a freshly created income', async () => {
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Gym Rental',
      amount: '45.00',
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
      overdue: true,
      next_skip_action: 'skip',
      created_at: createdAt,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym Rental' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const gym = rowButtons().find((row) => row.textContent?.includes('Gym Rental'))
    expect(gym?.textContent).toContain('1 unpaid')
    expect(gym?.textContent).toContain('Overdue')
    expect(
      screen.getByText('2 incomes overdue · 4 unpaid occurrences'),
    ).toBeInTheDocument()
  })
})
