# Recurring Costs track occurrences, not months

Recurring Costs are tracking-only definitions: the user records each payment by hand as a linked Expense, and the paid state is occurrence-based — Occurrences derived from a start date plus interval, each Paid by exactly one linked Expense (the oldest Unpaid one, pinned at link time). This deliberately deviates from the app's everywhere-else month bucketing (dashboard stats, search): the user cares how far behind a cost is, not which month a payment landed in, so the Backlog badge counts Unpaid Occurrences whose due date has passed.

## Considered Options

- **Month-level state** (a cost is Paid for month M if a linked Expense falls in M) — rejected: a daily cost missed for 10 days must show 10 unpaid, and paying an annual cost in February must mark the March Occurrence paid.
- **Count-picker catch-up** (one transaction covers N Occurrences) — rejected: one transaction pays exactly one Occurrence; clearing a backlog means one transaction per missed Occurrence.
