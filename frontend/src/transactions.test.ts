/** The ledger row's bold title: the Category leads (it implies the type),
 * then the whole Description; the type word survives only as the fallback
 * when neither exists. Opening Balance keeps its fixed label, and a
 * whitespace-only Description counts as blank (CONTEXT.md). */
import { describe, expect, it } from 'vitest'

import type { Transaction } from './api'
import { locationSuffix, transactionTitle } from './transactions'

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
  recurring_income_id: null,
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

describe('locationSuffix', () => {
  const withCoordinates = { ...base, latitude: '41.9028', longitude: '12.4964' }

  it('is null when the Transaction has no coordinates', () => {
    expect(locationSuffix(base)).toBeNull()
    // Coordinates-only, but only one half present — still no location.
    expect(locationSuffix({ ...base, latitude: '41.9028' })).toBeNull()
  })

  it('returns the bare pin when the location carries no Place', () => {
    expect(locationSuffix(withCoordinates)).toBe(' · 📍')
    expect(locationSuffix({ ...withCoordinates, place_name: null })).toBe(' · 📍')
    expect(locationSuffix({ ...withCoordinates, place_name: '' })).toBe(' · 📍')
    // A whitespace-only name counts as none (CONTEXT.md).
    expect(locationSuffix({ ...withCoordinates, place_name: '   ' })).toBe(' · 📍')
  })

  it('reads `📍 <place_name>` when the location carries a Place name', () => {
    const withPlace = { ...withCoordinates, place_name: 'Esselunga' }
    expect(locationSuffix(withPlace)).toBe(' · 📍 Esselunga')
    // The name is display text: trimmed before it joins the subtitle.
    expect(locationSuffix({ ...withPlace, place_name: '  Esselunga ' })).toBe(
      ' · 📍 Esselunga',
    )
  })
})
