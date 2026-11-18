/** Draft Transactions resource (ADR-0036, issues #122/#123/#125): the
 * stored, unapproved records the Assistant produces. The same columns as
 * a Transaction, each nullable — the Assistant may not have caught it —
 * and counting toward nothing until approved. Every write goes through
 * the transport, so it bumps the cache clock (ADR-0022). */

import {
  transactionCreateBody,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from './transactions'
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

/** Approve (ADR-0036, #125): one request creates the Transaction through
 * the create rules the form runs and removes the Draft. Without `input`
 * the Draft is judged as it stands — the one tap; with it, the form's
 * validated payload replaces the Draft's fields — the Save after a
 * rejected one tap. A rule the Draft breaks is a 422 whose `detail` is
 * the message, carried on the ApiError (`readDetail`) so the form can
 * show it in its banner; a Draft already approved or discarded is a 403.
 * Resolves to the Transaction the ledger shows, warning included. */
export async function approveDraftTransaction(
  token: string,
  draftId: number,
  input?: TransactionInput,
): Promise<Transaction> {
  const response = await request(`/draft-transactions/${draftId}/approve`, {
    method: 'POST',
    token,
    json: input === undefined ? undefined : transactionCreateBody(input),
    errorMessage: 'Could not approve draft transaction',
    readDetail: true,
  })
  return (await response.json()) as Transaction
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
