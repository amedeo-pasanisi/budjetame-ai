/** Recurring Incomes screen (issue #60): the list renders every income
 * sorted by next due date, each row showing name, amount, interval, and the
 * next due date; the Backlog badge (issue #62) rides on the API's derived
 * state. The screen mirrors the Costs side (issue #56, ADR-0011).
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
    fetchRecurringIncomeOccurrences: vi.fn(),
    setRecurringIncomeOccurrenceSkipped: vi.fn(),
  }
})

import {
  ApiError,
  createRecurringIncome,
  deleteRecurringIncome,
  fetchRecurringIncomeOccurrences,
  fetchRecurringIncomes,
  updateRecurringIncome,
} from './api'

const createdAt = '2026-08-19T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const incomes: RecurringIncome[] = [
  {
    id: 1,
    name: 'Salary',
    amount: '2100.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: '2026-09-01',
    next_due_date: '2026-09-27',
    next_unpaid_occurrence_date: '2026-09-27',
    backlog_count: 0,
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Rent from Marco',
    amount: '600.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: '2026-09-01',
    next_due_date: '2026-09-01',
    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 3,
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Bonus',
    amount: '1500.00',
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
// its own per-definition read when an existing income opens for editing.
const occurrences = [
  { date: '2026-09-27', skipped: false },
  { date: '2026-09-01', skipped: true },
]

const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)
const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const updateRecurringIncomeMock = vi.mocked(updateRecurringIncome)
const deleteRecurringIncomeMock = vi.mocked(deleteRecurringIncome)
const fetchRecurringIncomeOccurrencesMock = vi.mocked(fetchRecurringIncomeOccurrences)

beforeEach(() => {
  fetchRecurringIncomesMock.mockResolvedValue(incomes)
  fetchRecurringIncomeOccurrencesMock.mockResolvedValue(occurrences)
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

describe('RecurringIncomesScreen rows', () => {
  it('renders every income sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = ['Rent from Marco', 'Salary', 'Bonus'].map(mainSurface)
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

describe('RecurringIncomesScreen row actions (ADR-0026)', () => {
  it('a main-surface tap requests the ledger jump for that income and opens no modal', async () => {
    const requestLedgerFilter = vi.fn()
    render(<RecurringIncomesScreen requestLedgerFilter={requestLedgerFilter} />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(mainSurface('Salary'))

    expect(requestLedgerFilter).toHaveBeenCalledTimes(1)
    expect(requestLedgerFilter).toHaveBeenCalledWith({
      kind: 'recurring-income',
      id: 1,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the ✎ button opens the edit modal for exactly that income', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Salary')
  })

  it('the card Skip/Un-skip button is gone: no Skip action on the rows', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Un-skip' })).not.toBeInTheDocument()
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
      start_date: '2026-09-01',
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
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
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Freelance's next due (2026-08-24) sorts it ahead of every fixture
    // income (all due in September).
    expect(
      mainSurface('Freelance').compareDocumentPosition(mainSurface('Rent from Marco')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
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
  it('edits an income from its ✎ button and keeps it in the sorted list', async () => {
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      next_due_date: '2026-09-27',
      next_unpaid_occurrence_date: '2026-09-27',
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Salary' }))
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
    expect(mainSurface('Salary').textContent).toContain('€2200.00')
  })

  it('loads the Occurrences section into the edit modal (ADR-0026)', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })

    await waitFor(() =>
      expect(fetchRecurringIncomeOccurrencesMock).toHaveBeenCalledWith('', 1),
    )
    expect(within(dialog).getByRole('heading', { name: 'Occurrences' })).toBeInTheDocument()
    for (const row of occurrences) {
      expect(within(dialog).getByText(row.date)).toBeInTheDocument()
    }
  })

  it('deletes an income with the tap-again confirmation', async () => {
    deleteRecurringIncomeMock.mockResolvedValue(undefined)
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Bonus' }))
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

describe('RecurringIncomesScreen backlog badge', () => {
  it('renders the badge only on an income with a Backlog', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    expect(mainSurface('Rent from Marco').textContent).toContain('3 unpaid')
    // Salary and Bonus have no Backlog: no badge.
    expect(mainSurface('Salary').textContent).not.toContain('unpaid')
  })

  it('updates the badge after a definition edit', async () => {
    // The edited income comes back with the fresh derived state: a changed
    // start date pushed two Occurrences behind it.
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      backlog_count: 2,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'Edit Salary' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mainSurface('Salary').textContent).toContain('2 unpaid')
  })

  it('shows the badge on a freshly created income', async () => {
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Gym Rental',
      amount: '45.00',
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: '2026-09-01',
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
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
    expect(mainSurface('Gym Rental').textContent).toContain('1 unpaid')
  })
})
