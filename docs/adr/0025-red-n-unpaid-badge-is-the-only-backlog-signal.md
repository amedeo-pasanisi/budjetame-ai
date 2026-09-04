# The red "N unpaid" badge is the only Backlog signal — Overdue is gone

Each Recurring Cost or Income card once carried two signals for one fact: a red "Overdue" mark and an amber "N unpaid" badge, both driven by the same derived set (the Backlog, ADR-0010 as read by issue #58), plus a screen summary line ("X costs overdue · N unpaid occurrences"). Grilling showed the double language was the confusion — users read "unpaid" and "overdue" as two different states when they are one, and an Unpaid Occurrence not yet due is not Overdue at all. We removed the Overdue mark, the summary line, and the derived `overdue` flag from the API; the one signal is a red "N unpaid" badge per card, shown when the Backlog is non-empty. The Backlog boundary is unchanged: an Occurrence due today is unpaid until its linked Transaction is recorded.

## Considered Options

- **Keep both signals but differentiate them** ("Overdue" for strictly past due, "N unpaid" for due today or earlier) — rejected: it recreates two states where the user perceives one, adds a color flip at midnight, and the count pill already answers "what remains to pay".
- **Keep the API `overdue` flag for a future consumer** — rejected: nothing reads it once the UI stops rendering the mark and the line; a non-empty `backlog_count` carries the same fact, and a dead derived field reopens the two-words-one-fact trap.

## Consequences

- `RecurringCostOut` and `RecurringIncomeOut` no longer carry `overdue`; the word disappears from the UI and is an avoid-term for Backlog in CONTEXT.md.
- The recurring screens show only the red "{N} unpaid" badge; the top summary line is gone.
