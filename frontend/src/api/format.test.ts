/** Tests for locale-aware formatting (issue #114).
 * Asserts through the real helpers, not mocks — that's the seam the
 * ticket specifies. */

import { beforeEach, describe, expect, it } from 'vitest'
import { formatEuros, formatSignedEuros, formatMonth, formatShortMonth, formatLedgerDate, setLocale, getLocale } from './format'

beforeEach(() => {
  // Reset to en between tests so module-level state never leaks
  setLocale('en')
})

describe('formatEuros', () => {
  it('defaults to en-US format (€1,000.42)', () => {
    expect(formatEuros('1000.42')).toBe('€1,000.42')
  })

  it('formats a whole-number amount under en-US', () => {
    expect(formatEuros('50')).toBe('€50.00')
  })

  it('formats a negative amount under en-US', () => {
    expect(formatEuros('-500.00')).toBe('-€500.00')
  })

  it('formats under it-IT (1000,42 € — 4-digit amounts have no group separator)', () => {
    expect(formatEuros('1000.42', 'it')).toBe('1000,42\u00A0€')
  })

  it('groups 5-digit amounts with . in it-IT', () => {
    expect(formatEuros('11000.00', 'it')).toBe('11.000,00\u00A0€')
  })

  it('formats an integer under it-IT', () => {
    expect(formatEuros('50', 'it')).toBe('50,00\u00A0€')
  })

  it('formats a negative amount under it-IT', () => {
    expect(formatEuros('-500.00', 'it')).toBe('-500,00\u00A0€')
  })

  it('reads the module-level locale when set', () => {
    setLocale('it')
    expect(formatEuros('1000.42')).toBe('1000,42\u00A0€')
  })

  it('falls back gracefully for a NaN amount', () => {
    expect(formatEuros('not-a-number')).toBe('€not-a-number')
  })
})

describe('formatSignedEuros', () => {
  it('shows + for a positive amount under en-US', () => {
    expect(formatSignedEuros('50.00')).toBe('+€50.00')
  })

  it('shows - for a negative amount under en-US', () => {
    expect(formatSignedEuros('-30.00')).toBe('-€30.00')
  })

  it('shows no sign for zero under en-US', () => {
    expect(formatSignedEuros('0.00')).toBe('€0.00')
  })

  it('shows + for a positive amount under it-IT', () => {
    expect(formatSignedEuros('50.00', 'it')).toBe('+50,00\u00A0€')
  })

  it('shows - for a negative amount under it-IT', () => {
    expect(formatSignedEuros('-30.00', 'it')).toBe('-30,00\u00A0€')
  })

  it('shows no sign for zero under it-IT', () => {
    expect(formatSignedEuros('0.00', 'it')).toBe('0,00\u00A0€')
  })
})

describe('formatMonth', () => {
  it('shows the English abbreviation by default', () => {
    expect(formatMonth('2026-08')).toBe('Aug 2026')
  })

  it('localizes under it-IT', () => {
    expect(formatMonth('2026-08', 'it')).toBe('ago 2026')
  })

  it('keeps an invalid month as-is', () => {
    expect(formatMonth('not-a-month')).toBe('not-a-month')
  })
})

describe('formatShortMonth', () => {
  it('shows the English abbreviation by default', () => {
    expect(formatShortMonth('2026-08')).toBe('Aug')
  })

  it('localizes under it-IT', () => {
    expect(formatShortMonth('2026-08', 'it')).toBe('ago')
  })

  it('carries the year on January bars', () => {
    expect(formatShortMonth('2026-01')).toContain("Jan '26")
  })
})

describe('formatLedgerDate', () => {
  it('keeps the canonical ISO form under en', () => {
    expect(formatLedgerDate('2026-08-23')).toBe('2026-08-23')
  })

  it('localizes under it-IT', () => {
    expect(formatLedgerDate('2026-08-23', 'it')).toBe('23 ago 2026')
  })

  it('passes through a malformed date', () => {
    expect(formatLedgerDate('nope')).toBe('nope')
  })
})

describe('getLocale / setLocale', () => {
  it('starts as en', () => {
    expect(getLocale()).toBe('en')
  })

  it('setLocale changes the return of getLocale', () => {
    setLocale('it')
    expect(getLocale()).toBe('it')
  })
})