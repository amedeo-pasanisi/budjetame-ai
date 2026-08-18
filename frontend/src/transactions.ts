import type { Transaction } from './api'

/** Expense/Income move money in and out of one Wallet; only Transfer touches
 * Contact Wallets (CONTEXT.md). */
export const NON_CONTACT_WALLET_TYPES = ['checking', 'credit_card', 'cash']

/** Today's date in the app's single fixed timezone (CONTEXT.md: Europe/Rome). */
export function todayInRome(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date())
}

export function signedAmount(transaction: Transaction): string {
  if (transaction.type === 'expense') return `-€${transaction.amount}`
  if (transaction.type === 'income') return `+€${transaction.amount}`
  // A Transfer and an Opening Balance move money without income/expense signs.
  return `€${transaction.amount}`
}

/** The Description as display text: trimmed, or null when missing or blank —
 * a whitespace-only Description counts as blank (CONTEXT.md). */
export function descriptionText(description: string | null): string | null {
  const trimmed = description?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** The ledger row's bold identifying line: an Opening Balance keeps its
 * fixed label; otherwise the Category leads (it implies the type), then the
 * whole Description — falling back to the type word only when neither
 * exists. A whitespace-only Description counts as blank (CONTEXT.md). */
export function transactionTitle(
  transaction: Transaction,
  categoryName: string | null,
): string {
  if (transaction.type === 'opening_balance') return 'Opening balance'
  const description = descriptionText(transaction.description)
  const parts: string[] = []
  if (categoryName !== null) parts.push(categoryName)
  if (description !== null) parts.push(description)
  if (parts.length > 0) return parts.join(' · ')
  if (transaction.type === 'expense') return 'Expense'
  if (transaction.type === 'income') return 'Income'
  return 'Transfer'
}

export function hasLocation(transaction: Transaction): boolean {
  return transaction.latitude !== null && transaction.longitude !== null
}
