/** Recurring Costs screen (issue #56): the list renders every cost sorted by
 * next due date, each row showing name, amount, interval, and the next due
 * date; the Backlog badge, the Overdue mark, and the summary line (issue
 * #58) ride on the API's derived state. Create, edit, and delete live in a
 * modal on this screen. The API client is mocked; the real display helpers
 * (interval text, euro formatting) stay live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringCostsScreen } from './RecurringCostsScreen'
import type { RecurringCost } from './api'

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
    fetchRecurringCosts: vi.fn(),
    createRecurringCost: vi.fn(),
    updateRecurringCost: vi.fn(),
    deleteRecurringCost: vi.fn(),
    toggleSkipRecurringCost: vi.fn(),
  }
})

import {
  ApiError,
  createRecurringCost,
  deleteRecurringCost,
  fetchRecurringCosts,
  toggleSkipRecurringCost,
  updateRecurringCost,
} from './api'

const createdAt = '2026-08-19T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const costs: RecurringCost[] = [
  {
    id: 1,
    name: 'Rent',
    amount: '850.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 1,
    due_month: null,
    next_due_date: '2026-09-01',
    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 0,
    overdue: false,
    next_skip_action: 'skip',
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Coffee',
    amount: '2.50',
    interval_value: 5,
    interval_unit: 'days',
    start_date: null,
    due_day: null,
    due_month: null,
    next_due_date: '2026-08-20',
    next_unpaid_occurrence_date: '2026-08-20',
    backlog_count: 3,
    overdue: true,
    next_skip_action: 'skip',
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Insurance',
    amount: '120.00',
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

const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const createRecurringCostMock = vi.mocked(createRecurringCost)
const updateRecurringCostMock = vi.mocked(updateRecurringCost)
const deleteRecurringCostMock = vi.mocked(deleteRecurringCost)
const toggleSkipRecurringCostMock = vi.mocked(toggleSkipRecurringCost)

beforeEach(() => {
  fetchRecurringCostsMock.mockResolvedValue(costs)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringCostsScreen rows', () => {
  it('renders every cost sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Coffee'),
      expect.stringContaining('Rent'),
      expect.stringContaining('Insurance'),
    ])
    // Each row shows the amount and the interval with the next due date.
    const texts = rows.map((row) => row.textContent ?? '')
    expect(texts[0]).toContain('€2.50')
    expect(texts[0]).toContain('Every 5 days · next due 2026-08-20')
    expect(texts[1]).toContain('€850.00')
    expect(texts[1]).toContain('Every month · next due 2026-09-01')
    expect(texts[2]).toContain('€120.00')
    expect(texts[2]).toContain('Every year · next due 2026-12-01')
  })

  it('keeps the empty state when there are no costs', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    render(<RecurringCostsScreen />)

    expect(
      await screen.findByText("No recurring costs yet. Add your first one to track what's due."),
    ).toBeInTheDocument()
  })

  it('shows the load error when the list cannot be fetched', async () => {
    fetchRecurringCostsMock.mockRejectedValue(new Error('down'))
    render(<RecurringCostsScreen />)

    expect(
      await screen.findByText('Could not load your recurring costs.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringCostsScreen create flow', () => {
  it('creates a cost from the modal and lands it at its sorted position', async () => {
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
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
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
      target: { value: 'weeks' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))

    await waitFor(() =>
      expect(createRecurringCostMock).toHaveBeenCalledWith('', {
        name: 'Gym',
        amount: '45.00',
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
    expect(rows[1]).toContain('Gym')
  })

  it('shows the validation error when the API rejects the create', async () => {
    createRecurringCostMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Rent' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))

    expect(
      await within(dialog).findByText('A recurring cost with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open with the draft intact.
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
  })
})

describe('RecurringCostsScreen edit and delete flows', () => {
  it('edits a cost from its row and keeps it in the sorted list', async () => {
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      next_due_date: '2026-09-01',
      next_unpaid_occurrence_date: '2026-09-01',
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(850)

    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRecurringCostMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ name: 'Rent', amount: '900.00' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rentRow = screen
      .getAllByRole('button')
      .find((row) => row.textContent?.includes('Rent'))
    expect(rentRow?.textContent).toContain('€900.00')
  })

  it('deletes a cost with the tap-again confirmation', async () => {
    deleteRecurringCostMock.mockResolvedValue(undefined)
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Coffee')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recurring cost' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringCostMock).toHaveBeenCalledWith('', 2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const third = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })
})

describe('RecurringCostsScreen skip button', () => {
  it('renders Skip or Un-skip per the API state, and keeps the card clickable', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    // Rent and Coffee have an unskipped next occurrence: Skip. Insurance
    // has nothing left to skip: Un-skip.
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Un-skip' })).toBeInTheDocument()
    // The card itself still opens the edit modal.
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    expect(
      await screen.findByRole('dialog', { name: 'Edit recurring cost' }),
    ).toBeInTheDocument()
  })

  it('skips the next occurrence and swaps in the returned state', async () => {
    toggleSkipRecurringCostMock.mockResolvedValue({
      ...costs[1],
      backlog_count: 0,
      overdue: false,
      next_skip_action: 'unskip',
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const skipButtons = screen.getAllByRole('button', { name: 'Skip' })
    fireEvent.click(skipButtons.find((button) => button.closest('li')?.textContent?.includes('Coffee')) as HTMLElement)

    await waitFor(() => expect(toggleSkipRecurringCostMock).toHaveBeenCalledWith('', 2))
    // The returned state re-renders the card: no badge, no Overdue mark,
    // the button now reads Un-skip (Coffee joins Insurance), and the
    // summary re-totals.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Un-skip' })).toHaveLength(2)
    })
    const coffee = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
      .find((row) => row.textContent?.includes('Coffee'))
    expect(coffee?.textContent).not.toContain('unpaid')
    expect(coffee?.textContent).not.toContain('Overdue')
    expect(
      screen.getByText('0 costs overdue · 0 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('shows the error message when the toggle fails', async () => {
    toggleSkipRecurringCostMock.mockRejectedValue(new Error('down'))
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip' })[0])

    expect(
      await screen.findByText('Could not update your recurring costs.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringCostsScreen backlog, Overdue, and the summary line', () => {
  /** The row buttons, in screen order — the badge and the Overdue mark live
   * inside them. */
  const rowButtons = () =>
    screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))

  it('shows the summary line with the overdue and unpaid totals', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    expect(
      screen.getByText('1 cost overdue · 3 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('renders the badge and the Overdue mark only on a cost with a Backlog', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const coffee = rowButtons().find((row) => row.textContent?.includes('Coffee'))
    expect(coffee?.textContent).toContain('3 unpaid')
    expect(coffee?.textContent).toContain('Overdue')

    // Rent and Insurance have no Backlog: no badge, no Overdue mark.
    const rent = rowButtons().find((row) => row.textContent?.includes('Rent'))
    expect(rent?.textContent).not.toContain('unpaid')
    expect(rent?.textContent).not.toContain('Overdue')
  })

  it('uses singular wording for one overdue cost and one unpaid occurrence', async () => {
    fetchRecurringCostsMock.mockResolvedValue([
      { ...costs[1], backlog_count: 1, overdue: true },
    ])
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    expect(
      screen.getByText('1 cost overdue · 1 unpaid occurrence'),
    ).toBeInTheDocument()
  })

  it('shows zero totals when nothing is behind, and hides the line when there are no costs', async () => {
    fetchRecurringCostsMock.mockResolvedValue([{ ...costs[0], backlog_count: 0, overdue: false }])
    render(<RecurringCostsScreen />)
    await screen.findByText('Rent')

    expect(
      screen.getByText('0 costs overdue · 0 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('updates the badge, the mark, and the summary after a definition edit', async () => {
    // The edited cost comes back with the fresh derived state: a changed
    // start date pushed two Occurrences behind it.
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      backlog_count: 2,
      overdue: true,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = rowButtons()
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rent = rowButtons().find((row) => row.textContent?.includes('Rent'))
    expect(rent?.textContent).toContain('2 unpaid')
    expect(rent?.textContent).toContain('Overdue')
    // The summary re-totals from the returned state: Rent joined Coffee.
    expect(
      screen.getByText('2 costs overdue · 5 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('shows the badge and the Overdue mark on a freshly created cost', async () => {
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
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
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const gym = rowButtons().find((row) => row.textContent?.includes('Gym'))
    expect(gym?.textContent).toContain('1 unpaid')
    expect(gym?.textContent).toContain('Overdue')
    expect(
      screen.getByText('2 costs overdue · 4 unpaid occurrences'),
    ).toBeInTheDocument()
  })
})
