# Recurring definitions are frozen, not deleted

Deleting a Recurring Cost or Recurring Income severed the FK link to its Transactions, cleared the pinned occurrence date, and dropped the definition's skips — the connection between the definition and its payment history was lost forever. Replacing delete with freeze keeps the definition in the database, read-only, with all links intact. Unfreezing restores it to active duty.

---

**Freeze semantics (same for Recurring Costs and Recurring Incomes):**

- Freezing removes all Unpaid and Skipped Occurrences (deletes the stored RecurringSkip rows for this definition), cleans the Backlog, and stops generating new Occurrences. The freeze date is the moment of the action.
- The definition becomes read-only: name, amount, interval, start date — nothing editable.
- Frozen definitions appear in a collapsed "Frozen Recurring" section of the respective screen, like Frozen Wallets do.
- The Budget excludes the definition from months whose first post-freeze occurrence would have fallen on or after the freeze date. Months before the freeze date are unaffected — their Occurrences still count toward Monthly Spendable as they did at the time.

**Unfreeze semantics:**

- Any frozen definition can be unfrozen at any time (no precondition).
- Unfreezing restores full editability: every field becomes mutable again.
- Occurrences resume on the definition's natural recurrence cycle from the original start date — the first Occurrence due on or after the unfreeze date is generated. Frozen-period Occurrences simply don't exist.
- If the definition's name collides with an active one, the unfreeze is rejected with a message ("An active recurring cost named X already exists — rename it first").

**Delete is replaced entirely.** The red button is now "Freeze". There is no separate "delete that severs links" — manually unlinking individual Transactions is the only way to sever a link.

**Applied to both sides**, mirroring ADR-0011 — Recurring Costs and Recurring Incomes get the same treatment.

## Considered Options

- **Freeze without cleaning unpaid Occurrences** — rejected: the Backlog would show stale unpaid counts forever, and no new transactions could pay them (frozen = read-only).
- **Freeze as one-way archival (no unfreeze)** — rejected during grilling: the ability to resume a old definition (e.g. a returning client contract) was important.
- **Keep "delete severs links" alongside freeze** — rejected: two irreversible one-way actions confuse which to pick; the single "Freeze" maps to the Wallet model the user already knows.
- **Freeze making the definition disappear from derived computations entirely (past too)** — rejected: past Budget numbers would retroactively change, which is surprising.