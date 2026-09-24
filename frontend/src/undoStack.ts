/** Pure-module client-side undo buffer (ADR-0031).
 *
 * After deleting a Transaction the frontend keeps the deleted row in an
 * in-memory buffer. Up to three entries stack (newest first); a fourth
 * delete retires the oldest. Expiry (10-second timer) removes the entry.
 * A page refresh clears the stack entirely.
 *
 * The module is deliberately free of React: it is a pure data structure
 * that the UI layer reads and writes through its public functions. Tests
 * verify the insert/cap/expiry/clear logic in isolation.
 */

import type { Transaction } from './api'

/** One pending undo opportunity. */
export type UndoEntry = {
  /** The deleted Transaction's full row — the client replay payload. */
  transaction: Transaction
  /** Monotonic creation timestamp (ms since epoch) for ordering. */
  createdAt: number
}

/** The max number of toasts visible at once. */
export const MAX_UNDO = 3

/** The undo window in milliseconds. */
export const UNDO_WINDOW_MS = 10_000

/** Insert a deleted Transaction into the stack, capping at MAX_UNDO.
 * Returns the new stack with the newest entry first, and the entry that
 * was retired (if any) so the caller can clear its timer. */
export function pushEntry(
  stack: UndoEntry[],
  transaction: Transaction,
  now: number,
): { stack: UndoEntry[]; retired: UndoEntry | null } {
  const entry: UndoEntry = { transaction, createdAt: now }
  const next = [entry, ...stack].slice(0, MAX_UNDO)
  const retired = stack.length >= MAX_UNDO ? stack[stack.length - 1] : null
  return { stack: next, retired }
}

/** Remove an entry by transaction id. Returns the new stack without that
 * entry — no-op when the id is not in the stack. */
export function removeEntry(stack: UndoEntry[], transactionId: number): UndoEntry[] {
  return stack.filter((e) => e.transaction.id !== transactionId)
}

/** Remove expired entries from the stack. An entry is expired when its
 * createdAt is older than now - UNDO_WINDOW_MS. Returns the new stack
 * (without the expired ones) and the list of expired entries. */
export function expireEntries(
  stack: UndoEntry[],
  now: number,
): { stack: UndoEntry[]; expired: UndoEntry[] } {
  const cutoff = now - UNDO_WINDOW_MS
  const expired: UndoEntry[] = []
  const remaining: UndoEntry[] = []
  for (const entry of stack) {
    if (entry.createdAt < cutoff) {
      expired.push(entry)
    } else {
      remaining.push(entry)
    }
  }
  return { stack: remaining, expired }
}

/** Clear the entire stack (e.g. on page refresh or successful Restore). */
export function clearStack(): UndoEntry[] {
  return []
}