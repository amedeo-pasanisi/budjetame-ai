/** Recurring definitions screen (issues #56, #60; ADR-0033): one screen for
 * both sides of the Recurring tab — the whole suite runs once per side,
 * against that side's mocked API calls, catalog strings and Ledger jump
 * kind. The list renders every definition sorted by next due date, each
 * row showing name, amount, interval, and the next due date; the Backlog
 * badge (issues #58, #62) rides on the API's derived state.
 *
 * Row structure (ADR-0026): like the Wallets rows (issue #93), a row is a
 * main tap surface plus a sibling ✎ button — never nested. The tap surface
 * opens the Transactions ledger pre-filtered to that definition (the shell's
 * requestLedgerFilter, issue #90); ✎ Edit opens the edit modal, where the
 * per-Occurrence Skip/Un-skip controls live — the card Skip/Un-skip button
 * is gone (ADR-0026), and the badge stays the only Backlog signal
 * (ADR-0025). Create, edit, and freeze live in a modal on this screen. The
 * API client is mocked; the real display helpers (interval text, euro
 * formatting) stay live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import { renderWithIntl } from './test/renderWithIntl'
import type { LedgerFilterRequest } from './App'
import { RecurringDefinitionsScreen } from './RecurringDefinitionsScreen'
import type { RecurringDefinition } from './api'
import type { RecurringSide } from './recurringSide'

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
    freezeRecurringCost: vi.fn(),
    unfreezeRecurringCost: vi.fn(),
    fetchRecurringCostOccurrences: vi.fn(),
    setRecurringCostOccurrenceSkipped: vi.fn(),
    fetchRecurringIncomes: vi.fn(),
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    freezeRecurringIncome: vi.fn(),
    unfreezeRecurringIncome: vi.fn(),
    fetchRecurringIncomeOccurrences: vi.fn(),
    setRecurringIncomeOccurrenceSkipped: vi.fn(),
  }
})

import {
  ApiError,
  createRecurringCost,
  createRecurringIncome,
  fetchRecurringCostOccurrences,
  fetchRecurringCosts,
  fetchRecurringIncomeOccurrences,
  fetchRecurringIncomes,
  freezeRecurringCost,
  freezeRecurringIncome,
  updateRecurringCost,
  updateRecurringIncome,
} from './api'

const createdAt = '2026-08-19T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const template = {
  frozen: false as const,
  created_at: createdAt,
}

const definitions: RecurringDefinition[] = [
  {
    ...template,
    id: 1,
    name: 'Rent',
    amount: '850.00',
    interval_value: 1,
    interval_unit: 'months',
    start_date: '2026-09-01',
    next_due_date: '2026-09-01',
    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 0,
  },
  {
    ...template,
    id: 2,
    name: 'Coffee',
    amount: '2.50',
    interval_value: 5,
    interval_unit: 'days',
    start_date: '2026-09-01',
    next_due_date: '2026-08-20',
    next_unpaid_occurrence_date: '2026-08-20',
    backlog_count: 3,
  },
  {
    ...template,
    id: 3,
    name: 'Insurance',
    amount: '1200.00',
    interval_value: 1,
    interval_unit: 'years',
    start_date: '2026-09-01',
    next_due_date: '2026-12-01',
    next_unpaid_occurrence_date: '2026-12-01',
    backlog_count: 0,
  },
]

// The edit modal's Occurrences section rows (ADR-0026): the section loads
// its own per-definition read when an existing definition opens for editing.
const occurrences = [
  { date: '2026-08-24', skipped: false },
  { date: '2026-08-20', skipped: true },
  { date: '2026-08-19', skipped: false },
]

/** A freshly created definition, as the mocked create returns it. */
const created: RecurringDefinition = {
  id: 9,
  name: 'Gym',
  amount: '45.00',
  interval_value: 1,
  interval_unit: 'weeks',
  start_date: '2026-09-01',
  next_due_date: '2026-08-24',
  next_unpaid_occurrence_date: '2026-08-24',
  backlog_count: 1,
  frozen: false,
  created_at: createdAt,
}

/** The two sides of the Recurring tab as the suite sees them: the side the
 * screen takes, the noun its catalog strings carry, the Ledger jump kind
 * its rows send, and that side's mocked API calls. */
const SIDES = [
  {
    side: 'costs' as RecurringSide,
    noun: 'recurring cost',
    jumpKind: 'recurring-cost',
    fetchAll: vi.mocked(fetchRecurringCosts),
    create: vi.mocked(createRecurringCost),
    update: vi.mocked(updateRecurringCost),
    freeze: vi.mocked(freezeRecurringCost),
    fetchOccurrences: vi.mocked(fetchRecurringCostOccurrences),
  },
  {
    side: 'incomes' as RecurringSide,
    noun: 'recurring income',
    jumpKind: 'recurring-income',
    fetchAll: vi.mocked(fetchRecurringIncomes),
    create: vi.mocked(createRecurringIncome),
    update: vi.mocked(updateRecurringIncome),
    freeze: vi.mocked(freezeRecurringIncome),
    fetchOccurrences: vi.mocked(fetchRecurringIncomeOccurrences),
  },
]

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

describe.each(SIDES)(
  'RecurringDefinitionsScreen · $side',
  ({ side, noun, jumpKind, fetchAll, create, update, freeze, fetchOccurrences }) => {
    const newLabel = `New ${noun}`
    const editLabel = `Edit ${noun}`
    const createLabel = `Create ${noun}`

    const renderScreen = (requestLedgerFilter?: (request: LedgerFilterRequest) => void) =>
      renderWithIntl(
        <RecurringDefinitionsScreen side={side} requestLedgerFilter={requestLedgerFilter} />,
      )

    beforeEach(() => {
      fetchAll.mockResolvedValue(definitions)
      fetchOccurrences.mockResolvedValue(occurrences)
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    describe('rows', () => {
      it('renders every definition sorted by next due date with name, amount, interval, and due date', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        const rows = ['Coffee', 'Rent', 'Insurance'].map(mainSurface)
        // Each row shows the amount and the interval with the next due date.
        const texts = rows.map((row) => row.textContent ?? '')
        expect(texts[0]).toContain('€2.50')
        expect(texts[0]).toContain('Every 5 days · next due 2026-08-20')
        expect(texts[1]).toContain('€850.00')
        expect(texts[1]).toContain('Every month · next due 2026-09-01')
        // Thousands are grouped on both sides: the live euro formatter.
        expect(texts[2]).toContain('€1,200.00')
        expect(texts[2]).toContain('Every year · next due 2026-12-01')
      })

      it('fetches the frozen definitions too, for the collapsed Frozen Recurring section', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        expect(fetchAll).toHaveBeenCalledWith('', true)
      })

      it('keeps the empty state when there are no definitions', async () => {
        fetchAll.mockResolvedValue([])
        renderScreen()

        expect(
          await screen.findByText(`No ${noun}s yet. Add your first one to track what's due.`),
        ).toBeInTheDocument()
      })

      it('shows the load error when the list cannot be fetched', async () => {
        fetchAll.mockRejectedValue(new Error('down'))
        renderScreen()

        expect(await screen.findByText(`Could not load your ${noun}s.`)).toBeInTheDocument()
      })
    })

    describe('row actions (ADR-0026)', () => {
      it('a main-surface tap requests the ledger jump for that definition and opens no modal', async () => {
        const requestLedgerFilter = vi.fn()
        renderScreen(requestLedgerFilter)
        await screen.findByText('Coffee')

        fireEvent.click(mainSurface('Rent'))

        expect(requestLedgerFilter).toHaveBeenCalledTimes(1)
        expect(requestLedgerFilter).toHaveBeenCalledWith({ kind: jumpKind, id: 1 })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('the ✎ button opens the edit modal for exactly that definition', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
        const dialog = await screen.findByRole('dialog', { name: editLabel })
        expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
      })

      it('the card Skip/Un-skip button is gone: no Skip action on the rows', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Un-skip' })).not.toBeInTheDocument()
      })
    })

    describe('create flow', () => {
      it('creates a definition from the modal and lands it at its sorted position', async () => {
        create.mockResolvedValue(created)
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: newLabel }))
        const dialog = await screen.findByRole('dialog', { name: newLabel })
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
        fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
          target: { value: 'weeks' },
        })
        fireEvent.click(within(dialog).getByRole('button', { name: createLabel }))

        await waitFor(() =>
          expect(create).toHaveBeenCalledWith('', {
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
        create.mockRejectedValue(new ApiError('Conflict', 409))
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: newLabel }))
        const dialog = await screen.findByRole('dialog', { name: newLabel })
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Rent' } })
        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
        fireEvent.click(within(dialog).getByRole('button', { name: createLabel }))

        expect(
          await within(dialog).findByText(`A ${noun} with this name already exists.`),
        ).toBeInTheDocument()
        // The modal stays open with the draft intact.
        expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
      })
    })

    describe('edit and freeze flows', () => {
      it('edits a definition from its ✎ button and keeps it in the sorted list', async () => {
        update.mockResolvedValue({
          ...definitions[0],
          amount: '900.00',
          next_due_date: '2026-09-01',
          next_unpaid_occurrence_date: '2026-09-01',
        })
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
        const dialog = await screen.findByRole('dialog', { name: editLabel })
        expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
        expect(within(dialog).getByLabelText('Amount')).toHaveValue('850.00')

        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() =>
          expect(update).toHaveBeenCalledWith(
            '',
            1,
            expect.objectContaining({ name: 'Rent', amount: '900.00' }),
          ),
        )
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(mainSurface('Rent').textContent).toContain('€900.00')
      })

      it('loads the Occurrences section into the edit modal (ADR-0026)', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
        const dialog = await screen.findByRole('dialog', { name: editLabel })

        await waitFor(() => expect(fetchOccurrences).toHaveBeenCalledWith('', 1))
        expect(within(dialog).getByRole('heading', { name: 'Occurrences' })).toBeInTheDocument()
        for (const row of occurrences) {
          expect(within(dialog).getByText(row.date)).toBeInTheDocument()
        }
      })

      it('freezes a definition with the tap-again confirmation and moves it to the Frozen section', async () => {
        freeze.mockResolvedValue({
          ...definitions[1],
          frozen: true,
          next_due_date: null,
          next_unpaid_occurrence_date: null,
          backlog_count: 0,
        })
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: 'Edit Coffee' }))
        const dialog = await screen.findByRole('dialog', { name: editLabel })

        fireEvent.click(within(dialog).getByRole('button', { name: `Freeze ${noun}` }))
        fireEvent.click(
          within(dialog).getByRole('button', { name: 'Tap again to confirm freeze' }),
        )

        await waitFor(() => expect(freeze).toHaveBeenCalledWith('', 2))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        // The frozen definition leaves the active list for the collapsed
        // Frozen Recurring section (ADR-0028), read-only and badge-less.
        const header = screen.getByRole('button', { name: `Frozen ${noun}s (1)` })
        expect(header).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
        fireEvent.click(header)
        expect(mainSurface('Coffee').textContent).toContain('Every 5 days · Frozen')
        expect(mainSurface('Coffee').textContent).not.toContain('unpaid')
      })

      it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: newLabel }))
        const dialog = await screen.findByRole('dialog', { name: newLabel })
        fireEvent.click(dialog.previousElementSibling as Element)
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: newLabel }))
        await screen.findByRole('dialog', { name: newLabel })
        fireEvent.keyDown(window, { key: 'Escape' })
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: newLabel }))
        const third = await screen.findByRole('dialog', { name: newLabel })
        fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

        expect(create).not.toHaveBeenCalled()
      })
    })

    describe('backlog badge', () => {
      it('renders the badge only on a definition with a Backlog', async () => {
        renderScreen()
        await screen.findByText('Coffee')

        expect(mainSurface('Coffee').textContent).toContain('3 unpaid')
        // Rent and Insurance have no Backlog: no badge.
        expect(mainSurface('Rent').textContent).not.toContain('unpaid')
      })

      it('updates the badge after a definition edit', async () => {
        // The edited definition comes back with the fresh derived state: a
        // changed start date pushed two Occurrences behind it.
        update.mockResolvedValue({
          ...definitions[0],
          amount: '900.00',
          backlog_count: 2,
        })
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: 'Edit Rent' }))
        const dialog = await screen.findByRole('dialog', { name: editLabel })
        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(mainSurface('Rent').textContent).toContain('2 unpaid')
      })

      it('shows the badge on a freshly created definition', async () => {
        create.mockResolvedValue(created)
        renderScreen()
        await screen.findByText('Coffee')

        fireEvent.click(screen.getByRole('button', { name: newLabel }))
        const dialog = await screen.findByRole('dialog', { name: newLabel })
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
        fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
        fireEvent.click(within(dialog).getByRole('button', { name: createLabel }))

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(mainSurface('Gym').textContent).toContain('1 unpaid')
      })
    })
  },
)
