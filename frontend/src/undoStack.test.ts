/** Tests for the pure undoStack module (ADR-0031, generalised to every
 * deletable kind by ADR-0034): a deleted Transaction, Wallet or Recurring
 * definition enters one stack, tagged with its kind and the label its
 * toast shows. */

import { describe, expect, it } from 'vitest'
import type { RecurringDefinition, Transaction, Wallet } from './api'
import {
  clearStack,
  entryKey,
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

const t1 = { ...baseTransaction, id: 1, description: 'First' }
const t2 = { ...baseTransaction, id: 2, description: 'Second' }
const t3 = { ...baseTransaction, id: 3, description: 'Third' }
const t4 = { ...baseTransaction, id: 4, description: 'Fourth' }

const deleted = (transaction: Transaction) => ({ kind: 'transaction' as const, entity: transaction })

describe('pushEntry', () => {
  it('adds the entry at the front (newest first)', () => {
    const { stack } = pushEntry([], deleted(t1), 1000)
    expect(stack).toHaveLength(1)
    expect(stack[0].kind).toBe('transaction')
    expect(stack[0].entity.id).toBe(1)
  })

  it('prepends newer entries before older ones', () => {
    const first = pushEntry([], deleted(t1), 1000).stack
    const second = pushEntry(first, deleted(t2), 2000)
    expect(second.stack).toHaveLength(2)
    expect(second.stack[0].entity.id).toBe(2) // newest first
    expect(second.stack[1].entity.id).toBe(1)
  })

  it('caps at MAX_UNDO and retires the oldest when full', () => {
    const s1 = pushEntry([], deleted(t1), 1000).stack
    const s2 = pushEntry(s1, deleted(t2), 2000).stack
    const s3 = pushEntry(s2, deleted(t3), 3000).stack
    expect(s3).toHaveLength(3)

    const result = pushEntry(s3, deleted(t4), 4000)
    expect(result.stack).toHaveLength(MAX_UNDO)
    // Newest first: t4, t3, t2
    expect(result.stack[0].entity.id).toBe(4)
    expect(result.stack[1].entity.id).toBe(3)
    expect(result.stack[2].entity.id).toBe(2)
    // The oldest (t1) was retired
    expect(result.retired).not.toBeNull()
    expect(result.retired!.entity.id).toBe(1)
  })

  it('retired is null when stack is below capacity', () => {
    const result = pushEntry([], deleted(t1), 1000)
    expect(result.retired).toBeNull()
  })

  it('labels a Transaction entry with its description, or nothing when blank', () => {
    expect(pushEntry([], deleted(t1), 1000).stack[0].label).toBe('First')
    const blank = pushEntry([], deleted({ ...t1, description: '  ' }), 1000)
    expect(blank.stack[0].label).toBeNull()
    const missing = pushEntry([], deleted({ ...t1, description: null }), 1000)
    expect(missing.stack[0].label).toBeNull()
  })

  it('labels a Wallet or a Recurring definition entry with its name', () => {
    const w = pushEntry([], { kind: 'wallet', entity: wallet }, 1000).stack[0]
    expect(w.kind).toBe('wallet')
    expect(w.label).toBe('Revolut')
    const c = pushEntry([], { kind: 'recurring-cost', entity: definition }, 1000).stack[0]
    expect(c.kind).toBe('recurring-cost')
    expect(c.label).toBe('Rent')
    const i = pushEntry([], { kind: 'recurring-income', entity: definition }, 1000).stack[0]
    expect(i.kind).toBe('recurring-income')
    expect(i.label).toBe('Rent')
  })

  it('shares one cap across kinds: a fourth delete of any kind retires the oldest', () => {
    const s1 = pushEntry([], deleted(t1), 1000).stack
    const s2 = pushEntry(s1, { kind: 'wallet', entity: wallet }, 2000).stack
    const s3 = pushEntry(s2, { kind: 'recurring-cost', entity: definition }, 3000).stack
    const result = pushEntry(s3, { kind: 'recurring-income', entity: definition }, 4000)
    expect(result.stack.map((entry) => entry.kind)).toEqual([
      'recurring-income',
      'recurring-cost',
      'wallet',
    ])
    expect(result.retired?.kind).toBe('transaction')
  })
})

describe('entryKey', () => {
  it('tells a Wallet and a Transaction with the same id apart', () => {
    const stack = pushEntry(
      pushEntry([], deleted(t1), 1000).stack,
      { kind: 'wallet', entity: wallet },
      2000,
    ).stack
    expect(new Set(stack.map(entryKey)).size).toBe(2)
  })
})

describe('removeEntry', () => {
  it('removes the one entry with that key', () => {
    const entries: UndoEntry[] = [
      { kind: 'transaction', entity: t2, label: 'Second', createdAt: 2000 },
      { kind: 'transaction', entity: t1, label: 'First', createdAt: 1000 },
    ]
    const updated = removeEntry(entries, entryKey(entries[1]))
    expect(updated).toHaveLength(1)
    expect(updated[0].entity.id).toBe(2)
  })

  it('leaves an entry of another kind with the same id alone', () => {
    const entries: UndoEntry[] = [
      { kind: 'wallet', entity: wallet, label: 'Revolut', createdAt: 2000 },
      { kind: 'transaction', entity: t1, label: 'First', createdAt: 1000 },
    ]
    const updated = removeEntry(entries, entryKey(entries[1]))
    expect(updated).toHaveLength(1)
    expect(updated[0].kind).toBe('wallet')
  })

  it('is a no-op when the key is not in the stack', () => {
    const entries: UndoEntry[] = [
      { kind: 'transaction', entity: t1, label: 'First', createdAt: 1000 },
    ]
    const updated = removeEntry(entries, 'transaction:99')
    expect(updated).toHaveLength(1)
    expect(updated[0].entity.id).toBe(1)
  })
})

describe('expireEntries', () => {
  it('removes entries older than UNDO_WINDOW_MS', () => {
    const entries: UndoEntry[] = [
      { kind: 'transaction', entity: t2, label: 'Second', createdAt: 5000 },
      { kind: 'wallet', entity: wallet, label: 'Revolut', createdAt: 1000 },
    ]
    const result = expireEntries(entries, 12000) // cutoff = 2000
    expect(result.stack).toHaveLength(1)
    expect(result.stack[0].entity.id).toBe(2)
    expect(result.expired).toHaveLength(1)
    expect(result.expired[0].kind).toBe('wallet')
  })

  it('keeps all entries when none is expired', () => {
    const entries: UndoEntry[] = [
      { kind: 'transaction', entity: t2, label: 'Second', createdAt: 9500 },
      { kind: 'transaction', entity: t1, label: 'First', createdAt: 5000 },
    ]
    const result = expireEntries(entries, 10000) // cutoff = 0
    expect(result.stack).toHaveLength(2)
    expect(result.expired).toHaveLength(0)
  })

  it('returns an empty stack when all are expired', () => {
    const entries: UndoEntry[] = [
      { kind: 'transaction', entity: t1, label: 'First', createdAt: 0 },
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
