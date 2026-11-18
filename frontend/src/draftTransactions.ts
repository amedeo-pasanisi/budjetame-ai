/** Pure helpers for the Drafts block (ADR-0036, issues #122/#123): how a
 * Draft Transaction — a Transaction's fields, any of them possibly missing
 * — reads in a row. The ledger's own helpers live in ./transactions; a
 * Draft differs only in what may be null. */
import type { DraftTransaction } from './api'
import { signAmount } from './transactions'

/** The Drafts row's amount, signed like a ledger row's. Null when the
 * Draft has no amount — the row marks it missing — and unsigned when the
 * amount is known but the type is not. */
export function draftSignedAmount(draft: DraftTransaction): string | null {
  return draft.amount === null ? null : signAmount(draft.type, draft.amount)
}

/** True when the Draft's Wallet side is a Transfer's two legs rather than
 * one Wallet: the type says so, or — type unknown — a leg was caught. */
export function draftIsTransfer(draft: DraftTransaction): boolean {
  if (draft.type !== null) return draft.type === 'transfer'
  return draft.source_wallet_id !== null || draft.destination_wallet_id !== null
}
