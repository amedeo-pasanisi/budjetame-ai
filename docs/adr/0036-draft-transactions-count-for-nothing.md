# Draft Transactions are a stored resource that counts for nothing

The Assistant must save what it understood without a tap, so the user can approve it later, from another device. A Draft Transaction is therefore its own server-side resource scoped to the Account — the fields of a Transaction, any of them possibly still missing — and it is not a Transaction: it enters no Balance, Net Worth, Budget or dashboard figure, and no Export, Backup or Restore carries it. Approve is one atomic endpoint that runs the create rules the form runs, creates the Transaction and removes the Draft in the same step; it accepts the edited fields, so a Draft the rules reject opens pre-filled in the Transaction form and that form's Save goes back through Approve. Discard removes the Draft with no Undo, and Drafts never expire.

## Considered Options

- **Drafts in the device's local storage** — rejected: they die with the browser and never reach the other client.
- **Drafts as Transactions with a "pending" flag** — rejected: every derived read (ADR-0001, ADR-0032, the Budget, the Duplicate check, Export) would need to learn the flag, and one forgotten filter moves money. A separate table cannot leak into a sum.
- **Approve as a client-side create followed by a delete** — rejected: two calls can leave a Draft behind or approve it twice; one endpoint in one database transaction cannot.
- **Undo on Discard** (ADR-0031) — rejected: a Draft has no history and is cheaper to dictate again than to keep in the undo stack.
- **Drafts in Backup** — rejected: a Backup is the Account's data state; a Draft is a suggestion the user has not accepted.
- **Expiry or a cap** — rejected: the pinned row above the ledger is the reminder; nothing silently disappears.

## Consequences

- The Transactions tab gains a pinned Drafts block above the ledger with Approve, Edit and Discard per row, missing fields marked; no tab badge.
- Rules run at Approve time, not at Draft time: a Wallet frozen in between, a Recurring link whose pin has since been paid, a Contact Wallet named as the Wallet of an Income all surface then, as the form's rule errors.
- A Draft keeps no record of the sentence that produced it; the row shows the interpretation only.
- The Android app shows Drafts as soon as it adds the rows and the two calls; nothing else in its ledger changes.
