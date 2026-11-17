# Frozen things with no history can be deleted; undo by client replay

ADR-0002 and ADR-0028 made freezing the only way out of the active lists: a Wallet or a Recurring definition keeps its Transactions and links, read-only, in a collapsed Frozen section. The sections then filled with things that never had a history — Wallets created by mistake, definitions tried out and abandoned — and nothing could remove them. We added Delete, bounded on two sides so the earlier decisions stand untouched: only a frozen thing can be deleted, and only one with no history — a Wallet no Transaction has ever touched (not as its Wallet, not as a Transfer leg, not by an Opening Balance), a Recurring definition with no linked Transaction. Anything with history stays frozen forever; a delete therefore never severs a link, never cascades a Transaction away, never moves a Balance or a past Budget. The delete is a single tap undone through the Transaction undo pattern (ADR-0031): the response returns the full row, the client keeps it for ten seconds, and a dedicated undo endpoint re-inserts it with its original id, still frozen.

Amends ADR-0002 (a Frozen Wallet now has a second exit besides unfreeze) and ADR-0028 (whose "delete is replaced entirely" holds for the delete that severed links; this one cannot).

## Considered Options

- **Delete from the active list** — rejected: it puts two red actions side by side and reopens the "which do I pick" confusion ADR-0028 closed. Delete lives only in the frozen thing's modal; freeze stays the one action on an active row.
- **Delete that severs links (set the Transaction's link to null)** — rejected: every paid Expense would become Discretionary and drain past Spendable Today, and past Monthly Spendable would drop; exactly the retroactive change ADR-0028 refused.
- **Delete that cascades the Wallet's Transactions** — rejected: a Transfer leg on a live Wallet would vanish and change that Wallet's Balance (ADR-0001); a Transaction linked to a Recurring definition would un-pay its Occurrence; dashboard statistics would change.
- **Tap-again confirmation** — rejected: the undo toast is the confirmation, as for Transactions (ADR-0031), and a history-free thing is cheap to bring back.
- **One undo stack per screen** — rejected: tabs are kept alive (ADR-0022), so a per-screen stack would survive a tab switch while hiding its toast. The stack moves to the app shell: one stack, one cap of three across every kind, visible on every tab, each toast naming the kind and the name.
- **Greyed-out Delete when history exists** — rejected: the button is always tappable; the backend refuses with a rule error naming the count ("This wallet has 12 transactions", "3 transactions are linked to this recurring cost — unlink them first") and the modal shows it inline, in the submit-and-validate spirit of ADR-0029. The list responses gain no count fields.

## Consequences

- The Wallet freeze endpoint stops spelling itself as HTTP DELETE: freeze becomes an explicit action like the Recurring one, and DELETE means delete on both resources.
- Each resource gains an undo endpoint mirroring the Transaction one: explicit-id insert, then the sequence re-synced so future ids never collide. The only failure is a name taken within the window (names are unique per Account, case-insensitively).
- Restore (ADR-0030) keeps clearing the whole stack. A deleted thing is absent from later Backups; restoring an older Backup brings it back like anything else.
- A frozen Wallet whose only Transaction is an Opening Balance has history: the Opening Balance must go first, through the ledger, before the Wallet can be deleted.
