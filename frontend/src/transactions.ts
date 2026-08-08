import type { Transaction } from './api'

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

export function transactionTitle(transaction: Transaction): string {
  if (transaction.type === 'opening_balance') return 'Opening balance'
  if (transaction.type === 'expense') return 'Expense'
  if (transaction.type === 'income') return 'Income'
  return 'Transfer'
}

export function hasLocation(transaction: Transaction): boolean {
  return transaction.latitude !== null && transaction.longitude !== null
}
