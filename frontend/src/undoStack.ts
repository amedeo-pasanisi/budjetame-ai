/** Pure-module client-side undo buffer (ADR-0031; one stack for every
 * deletable kind since ADR-0034).
 *
 * After deleting a Transaction, a Frozen Wallet or a frozen Recurring
 * definition the frontend keeps the deleted row in an in-memory buffer,
 * tagged with its kind. Up to three entries stack across kinds (newest
 * first); a fourth delete retires the oldest. Expiry (10-second timer)
 * removes the entry. A page refresh clears the stack entirely.
 *
 * The module is deliberately free of React: it is a pure data structure
 * that the UI layer reads and writes through its public functions. Tests
 * verify the insert/cap/expiry/clear logic in isolation.
 */

import type { RecurringDefinition, Transaction, Wallet } from './api'

/** A deleted entity with its kind: the replay payload the kind's undo
 * endpoint takes back (ADR-0031, ADR-0034). The two Recurring kinds are
 * distinct — they live in different tables behind different resources
 * (ADR-0011) — so each undo reaches the right one. */
export type DeletedEntity =
  | { kind: 'transaction'; entity: Transaction }
  | { kind: 'wallet'; entity: Wallet }
  | { kind: 'recurring-cost'; entity: RecurringDefinition }
  | { kind: 'recurring-income'; entity: RecurringDefinition }

export type UndoKind = DeletedEntity['kind']

/** One pending undo opportunity. */
export type UndoEntry = DeletedEntity & {
  /** What the toast names beside the kind's headline: the Transaction's
   * description, the Wallet's or definition's name — null when the
   * Transaction has none. */
  label: string | null
  /** Monotonic creation timestamp (ms since epoch) for ordering. */
  createdAt: number
}

/** The max number of toasts visible at once. */
export const MAX_UNDO = 3

/** The undo window in milliseconds. */
export const UNDO_WINDOW_MS = 10_000

/** The entry's identity in the stack: ids are only unique within a kind
 * (a Wallet and a Transaction may both be #3). */
export function entryKey(entry: DeletedEntity): string {
  return `${entry.kind}:${entry.entity.id}`
}

/** The label a deleted entity's toast shows. */
export function labelOf(deleted: DeletedEntity): string | null {
  if (deleted.kind === 'transaction') {
    const description = deleted.entity.description
    return description !== null && description.trim() !== '' ? description : null
  }
  return deleted.entity.name
}

/** Insert a deleted entity into the stack, capping at MAX_UNDO across
 * every kind. Returns the new stack with the newest entry first, and the
 * entry that was retired (if any) so the caller can clear its timer. */
export function pushEntry(
  stack: UndoEntry[],
  deleted: DeletedEntity,
  now: number,
): { stack: UndoEntry[]; retired: UndoEntry | null } {
  const entry: UndoEntry = { ...deleted, label: labelOf(deleted), createdAt: now }
  const next = [entry, ...stack].slice(0, MAX_UNDO)
  const retired = stack.length >= MAX_UNDO ? stack[stack.length - 1] : null
  return { stack: next, retired }
}

/** Remove an entry by its key (see `entryKey`). Returns the new stack
 * without that entry — no-op when the key is not in the stack. */
export function removeEntry(stack: UndoEntry[], key: string): UndoEntry[] {
  return stack.filter((entry) => entryKey(entry) !== key)
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
