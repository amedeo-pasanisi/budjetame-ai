/** Tests for the UndoToastStack component (ADR-0031; every deletable kind
 * since ADR-0034).
 *
 * Uses fake timers for the countdown and display helpers (queryByText,
 * getByRole) to assert what the user sees. The component seam is the
 * props: stack, onUndo, onDismiss — no API mocking needed. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from "@testing-library/react"
import { renderWithIntl } from "./test/renderWithIntl"
import type { RecurringDefinition, Transaction, Wallet } from './api'
import { entryKey } from './undoStack'
import { UndoToastStack, type UndoEntry } from './UndoToastStack'

const baseTransaction: Transaction = {
  id: 1,
  type: 'expense',
  amount: '10.00',
  date: '2026-08-01',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  recurring_cost_id: null,
  recurring_income_id: null,
  occurrence_date: null,
  description: 'Test',
  latitude: null,
  longitude: null,
  place_name: null,
  place_id: null,
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

const wallet: Wallet = {
  id: 1,
  name: 'Revolut',
  type: 'checking',
  balance: '0.00',
  frozen: true,
  created_at: '2026-08-01T10:00:00Z',
}

const definition: RecurringDefinition = {
  id: 1,
  name: 'Rent',
  amount: '850.00',
  interval_value: 1,
  interval_unit: 'months',
  start_date: '2026-09-01',
  next_due_date: null,
  next_unpaid_occurrence_date: null,
  backlog_count: 0,
  frozen: true,
  freeze_date: '2026-11-01',
  created_at: '2026-08-01T10:00:00Z',
}

const t1 = { ...baseTransaction, id: 1, description: 'Coffee' }
const t2 = { ...baseTransaction, id: 2, description: 'Lunch' }
const t3 = { ...baseTransaction, id: 3, description: 'Dinner' }

const entry = (transaction: Transaction, createdAt: number): UndoEntry => ({
  kind: 'transaction',
  entity: transaction,
  label: transaction.description,
  createdAt,
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UndoToastStack', () => {
  it('renders nothing when the stack is empty', () => {
    renderWithIntl(
      <UndoToastStack
        stack={[]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a toast for each entry, newest first', () => {
    const stack: UndoEntry[] = [entry(t2, Date.now() + 10000), entry(t1, Date.now())]
    renderWithIntl(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(2)
    // Newest first in the DOM (flex-col-reverse in the container)
    expect(statuses[1]).toHaveTextContent(/Coffee/)
    expect(statuses[0]).toHaveTextContent(/Lunch/)
  })

  it('shows the transaction description in the toast', () => {
    renderWithIntl(
      <UndoToastStack
        stack={[entry(t1, Date.now())]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Transaction deleted · Coffee')
  })

  it('names the kind and the name on Wallet and Recurring toasts (ADR-0034)', () => {
    const now = Date.now()
    const stack: UndoEntry[] = [
      { kind: 'recurring-income', entity: definition, label: 'Rent', createdAt: now },
      { kind: 'recurring-cost', entity: definition, label: 'Rent', createdAt: now },
      { kind: 'wallet', entity: wallet, label: 'Revolut', createdAt: now },
    ]
    renderWithIntl(
      <UndoToastStack stack={stack} onUndo={vi.fn()} onDismiss={vi.fn()} />,
    )

    const statuses = screen.getAllByRole('status')
    expect(statuses[0]).toHaveTextContent('Recurring income deleted · Rent')
    expect(statuses[1]).toHaveTextContent('Recurring cost deleted · Rent')
    expect(statuses[2]).toHaveTextContent('Wallet deleted · Revolut')
  })

  it('reads the headlines in Italian', () => {
    const now = Date.now()
    const stack: UndoEntry[] = [
      { kind: 'recurring-cost', entity: definition, label: 'Affitto', createdAt: now },
      { kind: 'wallet', entity: wallet, label: 'Revolut', createdAt: now },
      entry({ ...t1, description: 'Caffè' }, now),
    ]
    renderWithIntl(
      <UndoToastStack stack={stack} onUndo={vi.fn()} onDismiss={vi.fn()} />,
      { locale: 'it' },
    )

    const statuses = screen.getAllByRole('status')
    expect(statuses[0]).toHaveTextContent('Uscita ricorrente eliminata · Affitto')
    expect(statuses[1]).toHaveTextContent('Portafoglio eliminato · Revolut')
    expect(statuses[2]).toHaveTextContent('Transazione eliminata · Caffè')
    expect(screen.getAllByRole('button', { name: 'Annulla' })).toHaveLength(3)
  })

  it('shows a 10-second countdown that decreases over time', () => {
    renderWithIntl(
      <UndoToastStack
        stack={[entry(t1, Date.now())]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    // Initial countdown: 10s
    expect(screen.getByText('10s')).toBeInTheDocument()

    // Advance 3 seconds
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByText('7s')).toBeInTheDocument()

    // Advance another 4 seconds
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText('3s')).toBeInTheDocument()
  })

  it('calls onDismiss with the entry key when the countdown reaches 0', () => {
    const onDismiss = vi.fn()
    const stack = [entry(t1, Date.now())]
    renderWithIntl(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    // Advance 10 seconds past the window
    act(() => { vi.advanceTimersByTime(11000) })

    expect(onDismiss).toHaveBeenCalledWith(entryKey(stack[0]))
  })

  it('calls onUndo when the Undo button is tapped', () => {
    const onUndo = vi.fn()
    const stack = [entry(t1, Date.now())]
    renderWithIntl(
      <UndoToastStack
        stack={stack}
        onUndo={onUndo}
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onUndo).toHaveBeenCalledWith(stack[0])
  })

  it('calls onDismiss with the entry key when the ✕ button is tapped', () => {
    const onDismiss = vi.fn()
    const stack = [entry(t1, Date.now())]
    renderWithIntl(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledWith('transaction:1')
  })

  it('renders up to 3 toasts (newest first)', () => {
    const now = Date.now()
    const stack: UndoEntry[] = [entry(t3, now + 30000), entry(t2, now + 20000), entry(t1, now)]
    renderWithIntl(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(3)
  })

  it('shows the last undo failure above the toasts until dismissed, even with an empty stack', () => {
    const onDismissError = vi.fn()
    renderWithIntl(
      <UndoToastStack
        stack={[]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
        error="Undo failed: a Wallet with this name now exists"
        onDismissError={onDismissError}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Undo failed: a Wallet with this name now exists',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss undo error' }))
    expect(onDismissError).toHaveBeenCalled()
  })
})
