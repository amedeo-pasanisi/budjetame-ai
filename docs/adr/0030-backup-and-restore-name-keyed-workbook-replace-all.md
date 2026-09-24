# Backup and Restore: name-keyed complete workbook with replace-all restore

The only user-facing safety net was the ledger Export — a single-sheet transactions-only .xlsx that excludes Opening Balances, never carries Recurring links, and contains no Wallets, Categories, or Recurring definitions. We added a true Backup (a multi-sheet .xlsx carrying the Account's whole data state: Transactions including Opening Balances, Wallets, Categories, Recurring Costs/Incomes, and skips) and a Restore flow that atomically replaces all current data with the file's contents — a rollback to the point in time the Backup was exported. Entities are keyed by **name** (restore rebuilds by name, ids regenerate); the original database ids are carried in the file for reference only.

**Restore is deliberately not an Import.** Import merges and dedupes against existing rows (its Duplicate rule skips rows that already exist); Restore replaces everything in one DB transaction and fails closed — a malformed file changes nothing. The two flows never conflate, even though both accept .xlsx files. Restore lives in Settings (next to Delete account), guarded by a two-step confirmation that first offers a fresh Export-all of the current state, and warns when the file's origin marker doesn't match the signed-in Account (proceeding is allowed: restoring into a fresh Account is a legitimate migration path).

## Considered Options

- **Periodic server-side snapshots (daily/manual) stored in the database** — rejected during grilling: the user wanted the file in their own hands, on demand, saved wherever they want. The workbook *is* the backup; there is no server-side store.
- **Diff-based restore (only touch entities that differ)** — rejected: a combinatorial minefield across every entity type and its links; "make me the person I was on that date" is what restore means.
- **Restore-as-Import-mode (single flow)** — rejected: merge vs replace are different intents with different confirmations; folding them invites the exact confusion this ADR separates.
- **Keying by database id instead of name** — rejected: stale-id and cross-account collision risks, less human-readable file, and name-keying makes "restore into a fresh Account" work as free migration.
- **Backup file without an origin marker** — rejected: a finance file can end up anywhere; the warning (allow-proceed) is cheap protection against restoring a stale foreign file.

## Consequences

- A restore discards everything entered after the Backup date — that is the point, and the two-step confirm + offered current-state export make it a deliberately chosen door, not an accident.
- Restore clears the client-side Undo stack (stale by definition) and is itself not undoable.
- Account credentials, email, and Locale are not part of Backup or Restore.
- The workbook's id columns inform but never drive the restore; sequence state is irrelevant to it.