# Undo: client replay with id preservation and a three-toast stack

Deleting a Transaction was a hard, irreversible DB delete gated by a two-tap "tap again to confirm". We replaced the two-tap confirm with a single tap that deletes immediately, then offers a stack of up to three **Undo toasts** (newest first), each with its own 10-second countdown, at the bottom of the screen. The toast is the confirmation — shown after the action, the Gmail pattern — and the window is client-enforced: it dies with the session, and a refresh loses it.

Undo works by **client replay**: the frontend keeps the deleted Transaction's full row (the DELETE response already returns `TransactionOut`) in an in-memory buffer, and on Undo sends it to a dedicated `POST /transactions/undo` endpoint. The server re-inserts the Transaction **with its original id** — the same entity coming back, not a copy — and re-syncs the Postgres sequence afterward so future auto-generated ids never collide. The original recurring pin (`recurring_cost_id` + `occurrence_date`) is restored exactly; if that Occurrence was already paid by another Transaction within the window, the undo fails with an explicit message rather than silently re-linking to a different Occurrence.

This is a distinct path from `TransactionCreate`, which intentionally has no `occurrence_date` field — the normal creation contract ("link pays the oldest Unpaid Occurrence at link time") stays untouched.

## Considered Options

- **Server-side tombstone / soft-delete with TTL** — rejected during grilling: the user chose client replay; the server trusts the client's payload and enforces no window of its own. A 10-second window is too short to justify a tombstone column and purge job.
- **Extending `TransactionCreate` with an undo-only `occurrence_date` field** — rejected: polluting the create contract with a fake field; a dedicated undo endpoint keeps the "no fake fields on regular create" invariant and gives a clean error channel for the pin-taken case.
- **Keep the two-tap confirm alongside Undo** — rejected: two trusts for one action are clunky; the toast is the confirmation.
- **Unlimited undo stack** — rejected: capped at three so a delete spree retires the oldest opportunity instead of piling toasts on the screen.

## Consequences

- A refresh (or navigation that unmounts the app session) silently forfeits all pending undo opportunities — accepted for a 10-second window.
- A successful Restore (ADR-0030) clears the whole undo stack as stale.
- The restored Transaction's id is preserved, so ledger cursor pagination (date, id keyset) is unaffected; the re-sync after explicit-id insert is the one non-obvious requirement.