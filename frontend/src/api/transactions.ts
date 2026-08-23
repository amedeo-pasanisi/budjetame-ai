/** Transactions resource (issue #17). */

import { request } from './transport'

export type TransactionType = 'expense' | 'income' | 'transfer' | 'opening_balance'

export type Transaction = {
  id: number
  type: TransactionType
  amount: string
  date: string
  wallet_id: number | null
  source_wallet_id: number | null
  destination_wallet_id: number | null
  category_id: number | null
  // The optional Recurring Cost link (issue #57): an Expense pinning one
  // cost, with the Occurrence (its own date) the link paid at link time —
  // stored, never reassigned by later date edits. Both null when unlinked.
  recurring_cost_id: number | null
  // The optional Recurring Income link (issue #61): an Income pinning one
  // Recurring Income, paying the same shared `occurrence_date` pin. A
  // Transaction is one type, so the two links never coexist.
  recurring_income_id: number | null
  occurrence_date: string | null
  description: string | null
  latitude: string | null
  longitude: string | null
  // The optional Place reference (ADR-0005): name plus provider id (e.g. a
  // Google place_id), written and cleared together with the coordinates.
  place_name: string | null
  place_id: string | null
  warning: boolean
  created_at: string
}

export type TransactionInput =
  | {
      type: 'expense' | 'income'
      amount: string
      date: string
      walletId: number
      categoryId: number | null
      // The optional Recurring Cost link (issue #57): Expenses only — the
      // form sends null for Income, and Transfers never carry the field.
      recurringCostId: number | null
      // The optional Recurring Income link (issue #61): Incomes only — the
      // form sends null for Expense, and Transfers never carry the field.
      recurringIncomeId: number | null
      description: string
      latitude: string | null
      longitude: string | null
      place_name: string | null
      place_id: string | null
    }
  | {
      type: 'transfer'
      amount: string
      date: string
      sourceWalletId: number
      destinationWalletId: number
      description: string
      latitude: string | null
      longitude: string | null
      place_name: string | null
      place_id: string | null
    }

export type TransactionFilters = {
  walletId?: number
  categoryId?: number
  fromDate?: string
  toDate?: string
  /** The Description needle (ADR-0009): sent only when non-blank; the
   * backend matches it case-insensitively as a literal substring. */
  q?: string
}

/** The paged ledger response (issue #30): one page of rows, newest first, and
 * the opaque cursor for the next page — null on the last page. Clients hand
 * the cursor back verbatim; they never parse it. */
export type TransactionPage = {
  items: Transaction[]
  next_cursor: string | null
}

/** Page size for the ledger, matching the backend default (issue #30). */
export const PAGE_LIMIT = 50

/** The query params the ledger filters and the export share (US 7.3): the
 * same names the backend accepts on both endpoints, so what the list shows
 * is exactly what the export writes. `q` rides along only when non-blank —
 * a blank or whitespace-only needle means no search (ADR-0009). */
function transactionParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.walletId !== undefined) {
    params.set('wallet_id', String(filters.walletId))
  }
  if (filters.categoryId !== undefined) {
    params.set('category_id', String(filters.categoryId))
  }
  if (filters.fromDate !== undefined && filters.fromDate !== '') {
    params.set('from_date', filters.fromDate)
  }
  if (filters.toDate !== undefined && filters.toDate !== '') {
    params.set('to_date', filters.toDate)
  }
  if (filters.q !== undefined && filters.q.trim() !== '') {
    params.set('q', filters.q)
  }
  return params
}

export async function fetchTransactions(
  token: string,
  filters: TransactionFilters = {},
  limit: number = PAGE_LIMIT,
  cursor: string | null = null,
): Promise<TransactionPage> {
  const params = transactionParams(filters)
  params.set('limit', String(limit))
  if (cursor !== null) {
    params.set('cursor', cursor)
  }
  const query = `?${params.toString()}`
  const response = await request(`/transactions${query}`, {
    token,
    errorMessage: 'Could not load transactions',
  })
  return (await response.json()) as TransactionPage
}

/** The export's download payload (US 7.3): the file's bytes and the filename
 * the server attached — the dated `budjetame-YYYY-MM-DD.xlsx` name decided
 * in Europe/Rome on the server, so the client never guesses the day. */
export type ExportFile = {
  blob: Blob
  filename: string
}

function exportFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/)
  return match?.[1] ?? 'budjetame-export.xlsx'
}

/** The ledger as the import template's .xlsx (US 7.3): all rows matching
 * `filters`, not just the visible page. The caller triggers the browser
 * download; the filename comes from Content-Disposition. */
export async function exportTransactions(
  token: string,
  filters: TransactionFilters = {},
): Promise<ExportFile> {
  const response = await request(`/transactions/export?${transactionParams(filters).toString()}`, {
    token,
    errorMessage: 'Could not export transactions',
  })
  return {
    blob: await response.blob(),
    filename: exportFilename(response.headers.get('content-disposition')),
  }
}

export async function createTransaction(
  token: string,
  input: TransactionInput,
): Promise<Transaction> {
  const base = {
    type: input.type,
    amount: input.amount,
    date: input.date,
    description: input.description === '' ? null : input.description,
    latitude: input.latitude,
    longitude: input.longitude,
    place_name: input.place_name,
    place_id: input.place_id,
  }
  const body =
    input.type === 'transfer'
      ? {
          ...base,
          source_wallet_id: input.sourceWalletId,
          destination_wallet_id: input.destinationWalletId,
        }
      : {
          ...base,
          wallet_id: input.walletId,
          category_id: input.categoryId,
          recurring_cost_id: input.recurringCostId,
          recurring_income_id: input.recurringIncomeId,
        }
  const response = await request('/transactions', {
    method: 'POST',
    token,
    json: body,
    errorMessage: 'Could not create transaction',
  })
  return (await response.json()) as Transaction
}

export async function updateTransaction(
  token: string,
  transactionId: number,
  input: {
    amount: string
    date: string
    categoryId?: number | null
    // The link is sent only when it changed: a field absent from the PATCH
    // leaves the stored pin untouched (a date edit must never reassign it,
    // issue #57); a value links, null unlinks.
    recurringCostId?: number | null
    // The Recurring Income link follows the same contract (issue #61):
    // omitted when unchanged, value links, null unlinks.
    recurringIncomeId?: number | null
    description: string
    latitude?: string | null
    longitude?: string | null
    place_name?: string | null
    place_id?: string | null
  },
): Promise<Transaction> {
  const body: Record<string, unknown> = {
    amount: input.amount,
    date: input.date,
    description: input.description === '' ? null : input.description,
  }
  // Transfers never carry a Category; omit category_id entirely for them.
  if (input.categoryId !== undefined) {
    body.category_id = input.categoryId
  }
  // Same contract for the Recurring Cost link: omitted when unchanged.
  if (input.recurringCostId !== undefined) {
    body.recurring_cost_id = input.recurringCostId
  }
  // Same contract for the Recurring Income link: omitted when unchanged.
  if (input.recurringIncomeId !== undefined) {
    body.recurring_income_id = input.recurringIncomeId
  }
  // The location is always sent: values set it, null clears it (the backend
  // applies any field present in the payload). The Place reference follows
  // the same contract (ADR-0005).
  body.latitude = input.latitude ?? null
  body.longitude = input.longitude ?? null
  body.place_name = input.place_name ?? null
  body.place_id = input.place_id ?? null
  const response = await request(`/transactions/${transactionId}`, {
    method: 'PATCH',
    token,
    json: body,
    errorMessage: 'Could not update transaction',
  })
  return (await response.json()) as Transaction
}

export type TransactionDeleteResult = {
  /** True when the delete left a Cash Wallet balance negative (US10/ID8):
   * the indicator belongs to writes — delete included — never to reads. */
  warning: boolean
}

export async function deleteTransaction(
  token: string,
  transactionId: number,
): Promise<TransactionDeleteResult> {
  const response = await request(`/transactions/${transactionId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not delete transaction',
  })
  return (await response.json()) as TransactionDeleteResult
}
