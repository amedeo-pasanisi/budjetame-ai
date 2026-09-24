/** Display helpers shared by the screens (issue #17: the API client is split
 * by resource, and this small shared module keeps the display helpers out of
 * the transport and resource modules).
 *
 * Locale-aware formatting (issue #114): under Locale `it`, amounts render
 * with Italian notation ("1.000,42 €") and dates localize; under `en` they
 * keep US notation ("€1,000.42"). Wire formats, stored amounts, Export, and
 * Backup stay US-canonical regardless.
 *
 * The module-level `currentLocale` is set once at app startup and read by
 * every screen — it's the component seam the ticket describes. Tests mock
 * these functions directly (they already do), so the seam is proven.
 */

let currentLocale: string = 'en'

/** Set the display Locale for all subsequent formatting calls. Called once
 * at app startup from the locale plumbing (issue #114). */
export function setLocale(locale: string): void {
  currentLocale = locale
}

/** The active locale code ('en' or 'it-IT' etc.). */
export function getLocale(): string {
  return currentLocale
}

/** Map the app's locale codes to standard BCP 47 tags: `en` → `en-US`,
 * `it` → `it-IT`; anything else is used as-is so Intl can resolve
 * fallbacks naturally. */
function localeTag(locale: string): string {
  return locale === 'it' ? 'it-IT' : 'en-US'
}

/** Build an Intl.NumberFormat for the given locale. The locale codes `en`
 * and `it` are mapped to their standard BCP 47 tags; anything else is used
 * as-is so Intl can resolve fallbacks naturally. */
function numberFormatter(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(localeTag(locale), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Display an amount string from the API as euros, locale-aware.
 * Under `en`: "€1,000.42" (US canonical)
 * Under `it`: "1.000,42 €" (Italian notation)
 * The `locale` parameter overrides the module default for testing. */
export function formatEuros(amount: string, locale?: string): string {
  const loc = locale ?? currentLocale
  const parsed = Number.parseFloat(amount)
  if (Number.isNaN(parsed)) return `€${amount}`
  return numberFormatter(loc).format(parsed)
}

/** "2026-08" → "Aug 2026" under `en`; "ago 2026" under `it` (issue #114).
 * Rendered dates follow the Account Locale; the exported and stored forms
 * stay US-canonical. The `locale` parameter overrides the module default. */
export function formatMonth(month: string, locale?: string): string {
  const loc = locale ?? currentLocale
  const [year, monthIndex] = month.split('-').map(Number)
  if (!year || !monthIndex || monthIndex < 1 || monthIndex > 12) return month
  return new Date(year, monthIndex - 1, 1).toLocaleDateString(localeTag(loc), {
    month: 'short',
    year: 'numeric',
  })
}

/** "2026-08" → "Aug" under `en`; "ago" under `it`. January bars also carry
 * the year so long ranges stay readable ("Jan '26"). */
export function formatShortMonth(month: string, locale?: string): string {
  const loc = locale ?? currentLocale
  const [year, monthIndex] = month.split('-').map(Number)
  if (!year || !monthIndex || monthIndex < 1 || monthIndex > 12) return month
  const short = new Date(year, monthIndex - 1, 1).toLocaleDateString(localeTag(loc), {
    month: 'short',
  })
  return monthIndex === 1 ? `${short} '${String(year).slice(2)}` : short
}

/** A ledger date "2026-08-23" as the user sees it: the canonical ISO form
 * under `en`, localized ("23 ago 2026") under `it` (issue #114). The stored
 * and wire form always stays ISO. */
export function formatLedgerDate(date: string, locale?: string): string {
  const loc = locale ?? currentLocale
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  if (loc !== 'it') return date
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Display a Wallet balance with a sign, in the transaction-amount convention
 * (issue #47): "+€50.00" for a positive balance, "-€30.00" for a negative
 * one, and unsigned "€0.00" for zero — a settled Contact is neutral, like a
 * Transfer. The sign is informative everywhere: a positive Credit Card
 * balance means the bank owes the user.
 *
 * Locale-aware: under `it` the euro sign moves to the right.
 * The `locale` parameter overrides the module default for testing. */
export function formatSignedEuros(amount: string, locale?: string): string {
  const loc = locale ?? currentLocale
  const parsed = Number.parseFloat(amount)

  if (Number.isNaN(parsed)) {
    if (amount.startsWith('-')) return `-€${amount.slice(1)}`
    return `€${amount}`
  }

  if (parsed > 0) {
    return `+${numberFormatter(loc).format(parsed)}`
  }
  if (parsed < 0) {
    return `-${numberFormatter(loc).format(Math.abs(parsed))}`
  }
  return numberFormatter(loc).format(0)
}