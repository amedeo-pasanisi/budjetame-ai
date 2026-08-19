/** The ledger row's bold title: the Category leads (it implies the type),
 * then the whole Description; the type word survives only as the fallback
 * when neither exists. Opening Balance keeps its fixed label, and a
 * whitespace-only Description counts as blank (CONTEXT.md). */
import { describe, expect, it } from 'vitest'

import type { Transaction } from './api'
import { transactionTitle } from './transactions'

const base: Transaction = {
  id: 1,
  type: 'expense',
  amount: '4.50',
  date: '2026-08-01',
  wallet_id: 1,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  recurring_cost_id: null,
  occurrence_date: null,
  description: null,
  latitude: null,
  longitude: null,
  place_name: null,
  place_id: null,
  warning: false,
  created_at: '2026-08-01T10:00:00Z',
}

describe('transactionTitle', () => {
  it('keeps the fixed label for an Opening Balance', () => {
    const opening = { ...base, type: 'opening_balance' as const, description: 'Setup' }
    expect(transactionTitle(opening, 'Food')).toBe('Opening balance')
  })

  it('leads with the Category, then the Description', () => {
    const coffee = { ...base, description: 'Coffee at the bar' }
    expect(transactionTitle(coffee, 'Food')).toBe('Food · Coffee at the bar')
  })

  it('shows the Category alone when the Description is missing or blank', () => {
    expect(transactionTitle(base, 'Food')).toBe('Food')
    expect(transactionTitle({ ...base, description: '' }, 'Food')).toBe('Food')
    expect(transactionTitle({ ...base, description: '   ' }, 'Food')).toBe('Food')
  })

  it('shows the Description alone when there is no Category', () => {
    expect(transactionTitle({ ...base, description: 'Coffee at the bar' }, null)).toBe(
      'Coffee at the bar',
    )
  })

  it('falls back to the type word when neither exists', () => {
    expect(transactionTitle(base, null)).toBe('Expense')
    expect(transactionTitle({ ...base, type: 'income' }, null)).toBe('Income')
    expect(transactionTitle({ ...base, type: 'transfer' }, null)).toBe('Transfer')
  })

  it('never prepends a Category to a Transfer', () => {
    const transfer = { ...base, type: 'transfer' as const, description: 'To Marco' }
    expect(transactionTitle(transfer, null)).toBe('To Marco')
    expect(transactionTitle({ ...transfer, description: null }, null)).toBe('Transfer')
  })
})
