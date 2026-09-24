/** Tests for the pure undoStack module (ADR-0031). */

import { describe, expect, it } from 'vitest'
import type { Transaction } from './api'
import {
  clearStack,
  expireEntries,
  MAX_UNDO,
  pushEntry,
  removeEntry,
  type UndoEntry,
} from './undoStack'

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

const t1 = { ...baseTransaction, id: 1, description: 'First' }
const t2 = { ...baseTransaction, id: 2, description: 'Second' }
const t3 = { ...baseTransaction, id: 3, description: 'Third' }
const t4 = { ...baseTransaction, id: 4, description: 'Fourth' }

describe('pushEntry', () => {
  it('adds the entry at the front (newest first)', () => {
    const { stack } = pushEntry([], t1, 1000)
    expect(stack).toHaveLength(1)
    expect(stack[0].transaction.id).toBe(1)
  })

  it('prepends newer entries before older ones', () => {
    const first = pushEntry([], t1, 1000).stack
    const second = pushEntry(first, t2, 2000)
    expect(second.stack).toHaveLength(2)
    expect(second.stack[0].transaction.id).toBe(2) // newest first
    expect(second.stack[1].transaction.id).toBe(1)
  })

  it('caps at MAX_UNDO and retires the oldest when full', () => {
    const s1 = pushEntry([], t1, 1000).stack
    const s2 = pushEntry(s1, t2, 2000).stack
    const s3 = pushEntry(s2, t3, 3000).stack
    expect(s3).toHaveLength(3)

    const result = pushEntry(s3, t4, 4000)
    expect(result.stack).toHaveLength(MAX_UNDO)
    // Newest first: t4, t3, t2
    expect(result.stack[0].transaction.id).toBe(4)
    expect(result.stack[1].transaction.id).toBe(3)
    expect(result.stack[2].transaction.id).toBe(2)
    // The oldest (t1) was retired
    expect(result.retired).not.toBeNull()
    expect(result.retired!.transaction.id).toBe(1)
  })

  it('retired is null when stack is below capacity', () => {
    const result = pushEntry([], t1, 1000)
    expect(result.retired).toBeNull()
  })
})

describe('removeEntry', () => {
  it('removes an entry by transaction id', () => {
    const entries: UndoEntry[] = [
      { transaction: t2, createdAt: 2000 },
      { transaction: t1, createdAt: 1000 },
    ]
    const updated = removeEntry(entries, 1)
    expect(updated).toHaveLength(1)
    expect(updated[0].transaction.id).toBe(2)
  })

  it('is a no-op when the id is not in the stack', () => {
    const entries: UndoEntry[] = [{ transaction: t1, createdAt: 1000 }]
    const updated = removeEntry(entries, 99)
    expect(updated).toHaveLength(1)
    expect(updated[0].transaction.id).toBe(1)
  })
})

describe('expireEntries', () => {
  it('removes entries older than UNDO_WINDOW_MS', () => {
    const entries: UndoEntry[] = [
      { transaction: t2, createdAt: 5000 },
      { transaction: t1, createdAt: 1000 },
    ]
    const result = expireEntries(entries, 12000) // cutoff = 2000
    expect(result.stack).toHaveLength(1)
    expect(result.stack[0].transaction.id).toBe(2)
    expect(result.expired).toHaveLength(1)
    expect(result.expired[0].transaction.id).toBe(1)
  })

  it('keeps all entries when none is expired', () => {
    const entries: UndoEntry[] = [
      { transaction: t2, createdAt: 9500 },
      { transaction: t1, createdAt: 5000 },
    ]
    const result = expireEntries(entries, 10000) // cutoff = 0
    expect(result.stack).toHaveLength(2)
    expect(result.expired).toHaveLength(0)
  })

  it('returns an empty stack when all are expired', () => {
    const entries: UndoEntry[] = [
      { transaction: t1, createdAt: 0 },
    ]
    const result = expireEntries(entries, 20000)
    expect(result.stack).toHaveLength(0)
    expect(result.expired).toHaveLength(1)
  })
})

describe('clearStack', () => {
  it('returns an empty array', () => {
    expect(clearStack()).toEqual([])
  })
})