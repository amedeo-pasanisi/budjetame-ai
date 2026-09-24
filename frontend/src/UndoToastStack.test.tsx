/** Tests for the UndoToastStack component (ADR-0031).
 *
 * Uses fake timers for the countdown and display helpers (queryByText,
 * getByRole) to assert what the user sees. The component seam is the
 * props: stack, onUndo, onDismiss — no API mocking needed. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Transaction } from './api'
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

const t1 = { ...baseTransaction, id: 1, description: 'Coffee' }
const t2 = { ...baseTransaction, id: 2, description: 'Lunch' }
const t3 = { ...baseTransaction, id: 3, description: 'Dinner' }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UndoToastStack', () => {
  it('renders nothing when the stack is empty', () => {
    render(
      <UndoToastStack
        stack={[]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('renders a toast for each entry, newest first', () => {
    const stack: UndoEntry[] = [
      { transaction: t2, createdAt: Date.now() + 10000 },
      { transaction: t1, createdAt: Date.now() },
    ]
    render(
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
    const stack: UndoEntry[] = [
      { transaction: t1, createdAt: Date.now() },
    ]
    render(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByText(/Coffee/)).toBeInTheDocument()
    expect(screen.getByText(/Transaction deleted/)).toBeInTheDocument()
  })

  it('shows a 10-second countdown that decreases over time', () => {
    const now = Date.now()
    const stack: UndoEntry[] = [
      { transaction: t1, createdAt: now },
    ]
    render(
      <UndoToastStack
        stack={stack}
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

  it('calls onDismiss when the countdown reaches 0', () => {
    const onDismiss = vi.fn()
    const now = Date.now()
    const stack: UndoEntry[] = [
      { transaction: t1, createdAt: now },
    ]
    render(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    // Advance 10 seconds past the window
    act(() => { vi.advanceTimersByTime(11000) })

    expect(onDismiss).toHaveBeenCalledWith(1)
  })

  it('calls onUndo when the Undo button is tapped', () => {
    const onUndo = vi.fn()
    const now = Date.now()
    const stack: UndoEntry[] = [
      { transaction: t1, createdAt: now },
    ]
    render(
      <UndoToastStack
        stack={stack}
        onUndo={onUndo}
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onUndo).toHaveBeenCalledWith(stack[0])
  })

  it('calls onDismiss when the ✕ button is tapped', () => {
    const onDismiss = vi.fn()
    const now = Date.now()
    const stack: UndoEntry[] = [
      { transaction: t1, createdAt: now },
    ]
    render(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledWith(1)
  })

  it('renders up to 3 toasts (newest first)', () => {
    const now = Date.now()
    const stack: UndoEntry[] = [
      { transaction: t3, createdAt: now + 30000 },
      { transaction: t2, createdAt: now + 20000 },
      { transaction: t1, createdAt: now },
    ]
    render(
      <UndoToastStack
        stack={stack}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(3)
  })
})