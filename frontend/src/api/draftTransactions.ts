/** Draft Transactions resource (ADR-0036, issues #122/#123): the stored,
 * unapproved records the Assistant produces. The same columns as a
 * Transaction, each nullable — the Assistant may not have caught it — and
 * counting toward nothing until approved (#125). Every write goes through
 * the transport, so it bumps the cache clock (ADR-0022). */

import type { TransactionType } from './transactions'
import { request } from './transport'

/** The types a Draft can take: a Transaction's minus Opening Balance,
 * which only the Wallet lifecycle creates. */
export type DraftTransactionType = Exclude<TransactionType, 'opening_balance'>

export type DraftTransaction = {
  id: number
  type: DraftTransactionType | null
  amount: string | null
  /** The Europe/Rome calendar day, `YYYY-MM-DD`, or null when not caught. */
  date: string | null
  wallet_id: number | null
  source_wallet_id: number | null
  destination_wallet_id: number | null
  category_id: number | null
  recurring_cost_id: number | null
  recurring_income_id: number | null
  description: string | null
  created_at: string
}

/** The writable fields of a Draft: any subset on create; on update a field
 * present is applied even when null (clearing it), absent is untouched. */
export type DraftTransactionInput = Partial<Omit<DraftTransaction, 'id' | 'created_at'>>

export async function fetchDraftTransactions(token: string): Promise<DraftTransaction[]> {
  const response = await request('/draft-transactions', {
    token,
    errorMessage: 'Could not load draft transactions',
  })
  return (await response.json()) as DraftTransaction[]
}

export async function createDraftTransaction(
  token: string,
  input: DraftTransactionInput,
): Promise<DraftTransaction> {
  const response = await request('/draft-transactions', {
    method: 'POST',
    token,
    json: input,
    errorMessage: 'Could not create draft transaction',
  })
  return (await response.json()) as DraftTransaction
}

export async function updateDraftTransaction(
  token: string,
  draftId: number,
  changes: DraftTransactionInput,
): Promise<DraftTransaction> {
  const response = await request(`/draft-transactions/${draftId}`, {
    method: 'PATCH',
    token,
    json: changes,
    errorMessage: 'Could not update draft transaction',
  })
  return (await response.json()) as DraftTransaction
}

/** Discard (ADR-0036): the Draft is removed, nothing is created, nothing
 * it referred to changes, and there is no Undo. */
export async function discardDraftTransaction(token: string, draftId: number): Promise<void> {
  await request(`/draft-transactions/${draftId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not discard draft transaction',
  })
}
