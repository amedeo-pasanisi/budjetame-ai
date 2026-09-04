# Recurring Costs track occurrences, not months

Recurring Costs are tracking-only definitions: the user records each payment by hand as a linked Expense, and the paid state is occurrence-based — Occurrences derived from a start date plus interval, each Paid by exactly one linked Expense (the oldest Unpaid one, pinned at link time). This deliberately deviates from the app's everywhere-else month bucketing (dashboard stats, search): the user cares how far behind a cost is, not which month a payment landed in, so the Backlog badge counts Unpaid Occurrences whose due date has passed.

A Recurring Cost carries no Wallet and no Category: the definition is name + amount + interval + start date. (ADR-0024: the optional due-date override is gone — an Occurrence is due on its own date.) The Wallet and Category of a linked Expense are chosen at Transaction creation time, so the definition's copies would be redundant state — two places to keep in sync for a value the Budget and the Occurrence math never read.

## Considered Options

- **Month-level state** (a cost is Paid for month M if a linked Expense falls in M) — rejected: a daily cost missed for 10 days must show 10 unpaid, and paying an annual cost in February must mark the March Occurrence paid.
- **Count-picker catch-up** (one transaction covers N Occurrences) — rejected: one transaction pays exactly one Occurrence; clearing a backlog means one transaction per missed Occurrence.
- **Wallet + Category on the definition** — rejected (see above): the linked Transaction already chooses them at creation time, and nothing derived (Occurrences, Backlog, Budget) reads them.
