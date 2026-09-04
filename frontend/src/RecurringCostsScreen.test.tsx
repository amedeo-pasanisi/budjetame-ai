/** Recurring Costs screen (issue #56): the list renders every cost sorted by
 * next due date, each row showing name, amount, interval, and the next due
 * date; the Backlog badge (issue #58) rides on the API's derived state.
 *
 * Row structure (ADR-0026): like the Wallets rows (issue #93), a row is a
 * main tap surface plus a sibling ✎ button — never nested. The tap surface
 * opens the Transactions ledger pre-filtered to that definition (the shell's
 * requestLedgerFilter, issue #90); ✎ Edit opens the edit modal, where the
 * per-Occurrence Skip/Un-skip controls live — the card Skip/Un-skip button
 * is gone (ADR-0026), and the badge stays the only Backlog signal
 * (ADR-0025). Create, edit, and delete live in a modal on this screen. The
 * API client is mocked; the real display helpers (interval text, euro
 * formatting) stay live. */
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
    fetchRecurringCostOccurrences: vi.fn(),
    setRecurringCostOccurrenceSkipped: vi.fn(),
  }
})

import {
  ApiError,
  createRecurringCost,
  deleteRecurringCost,
  fetchRecurringCostOccurrences,
  fetchRecurringCosts,
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
    start_date: '2026-09-01',
    next_due_date: '2026-09-01',
    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 0,
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Coffee',
    amount: '2.50',
    interval_value: 5,
    interval_unit: 'days',
    start_date: '2026-09-01',
    next_due_date: '2026-08-20',
    next_unpaid_occurrence_date: '2026-08-20',
    backlog_count: 3,
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Insurance',
    amount: '120.00',
    interval_value: 1,
    interval_unit: 'years',
    start_date: '2026-09-01',
    next_due_date: '2026-12-01',
    next_unpaid_occurrence_date: '2026-12-01',
    backlog_count: 0,
    created_at: createdAt,
  },
]

// The edit modal's Occurrences section rows (ADR-0026): the section loads
// its own per-definition read when an existing cost opens for editing.
const occurrences = [
  { date: '2026-08-24', skipped: false },
  { date: '2026-08-20', skipped: true },
  { date: '2026-08-19', skipped: false },
]

const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const createRecurringCostMock = vi.mocked(createRecurringCost)
const updateRecurringCostMock = vi.mocked(updateRecurringCost)
const deleteRecurringCostMock = vi.mocked(deleteRecurringCost)
const fetchRecurringCostOccurrencesMock = vi.mocked(fetchRecurringCostOccurrences)

beforeEach(() => {
  fetchRecurringCostsMock.mockResolvedValue(costs)
  fetchRecurringCostOccurrencesMock.mockResolvedValue(occurrences)
})

afterEach(() => {
  vi.clearAllMocks()
})

/** A row's main tap surface — the card's content button, told apart from
 * the ✎ sibling by its missing `Edit …` aria-label. */
function mainSurface(name: string): HTMLElement {
  const button = screen
    .getAllByRole('button')
    .find(
      (candidate) =>
        !(candidate.getAttribute('aria-label') ?? '').startsWith('Edit ') &&
        candidate.textContent?.includes(name),
    )
  expect(button, `main surface for ${name}`).toBeDefined()
  return button as HTMLElement
}

describe('RecurringCostsScreen rows', () => {
  it('renders every cost sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = ['Coffee', 'Rent', 'Insurance'].map(mainSurface)
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

describe('RecurringCostsScreen row actions (ADR-0026)', () => {
  it('a main-surface tap requests the ledger jump for that cost and opens no modal', async () => {
    const requestLedgerFilter = vi.fn()
    render(<RecurringCostsScreen requestLedgerFilter={requestLedgerFilter} />)
    await screen.findByText('Coffee')

    fireEvent.click(mainSurface('Rent'))

    expect(requestLedgerFilter).toHaveBeenCalledTimes(1)
    expect(requestLedgerFilter).toHaveBeenCalledWith({ kind: 'recurring-cost', id: 1 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the ✎ button opens the edit modal for exactly that cost', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
  })

  it('the card Skip/Un-skip button is gone: no Skip action on the rows', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Un-skip' })).not.toBeInTheDocument()
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
      start_date: '2026-09-01',
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
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
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Gym's next due (2026-08-24) sorts it after Coffee (2026-08-20) and
    // before Rent (2026-09-01).
    expect(
      mainSurface('Gym').compareDocumentPosition(mainSurface('Rent')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      mainSurface('Coffee').compareDocumentPosition(mainSurface('Gym')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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
  it('edits a cost from its ✎ button and keeps it in the sorted list', async () => {
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      next_due_date: '2026-09-01',
      next_unpaid_occurrence_date: '2026-09-01',
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
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
    expect(mainSurface('Rent').textContent).toContain('€900.00')
  })

  it('loads the Occurrences section into the edit modal (ADR-0026)', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })

    await waitFor(() => expect(fetchRecurringCostOccurrencesMock).toHaveBeenCalledWith('', 1))
    expect(within(dialog).getByRole('heading', { name: 'Occurrences' })).toBeInTheDocument()
    for (const row of occurrences) {
      expect(within(dialog).getByText(row.date)).toBeInTheDocument()
    }
  })

  it('deletes a cost with the tap-again confirmation', async () => {
    deleteRecurringCostMock.mockResolvedValue(undefined)
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Coffee' }))
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

describe('RecurringCostsScreen backlog badge', () => {
  it('renders the badge only on a cost with a Backlog', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    expect(mainSurface('Coffee').textContent).toContain('3 unpaid')
    // Rent and Insurance have no Backlog: no badge.
    expect(mainSurface('Rent').textContent).not.toContain('unpaid')
  })

  it('updates the badge after a definition edit', async () => {
    // The edited cost comes back with the fresh derived state: a changed
    // start date pushed two Occurrences behind it.
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      backlog_count: 2,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mainSurface('Rent').textContent).toContain('2 unpaid')
  })

  it('shows the badge on a freshly created cost', async () => {
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
      amount: '45.00',
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: '2026-09-01',
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
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
    expect(mainSurface('Gym').textContent).toContain('1 unpaid')
  })
})
