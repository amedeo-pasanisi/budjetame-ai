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
  description: string | null
  latitude: string | null
  longitude: string | null
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
      description: string
      latitude: string | null
      longitude: string | null
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
    }

export type TransactionFilters = {
  walletId?: number
  categoryId?: number
  fromDate?: string
  toDate?: string
}

export async function fetchTransactions(
  token: string,
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
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
  const query = params.size > 0 ? `?${params.toString()}` : ''
  const response = await request(`/transactions${query}`, {
    token,
    errorMessage: 'Could not load transactions',
  })
  return (await response.json()) as Transaction[]
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
    description: string
    latitude?: string | null
    longitude?: string | null
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
  // The location is always sent: values set it, null clears it (the backend
  // applies any field present in the payload).
  body.latitude = input.latitude ?? null
  body.longitude = input.longitude ?? null
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
