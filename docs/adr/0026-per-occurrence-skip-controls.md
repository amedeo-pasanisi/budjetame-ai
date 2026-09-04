# Per-Occurrence skip controls replace the card Skip/Un-skip button

Grilling found that the card-level Skip/Un-skip button (ADR-0016) could excuse at most one future Occurrence: a single toggle acts on the front of the queue, so once the whole Backlog was excused it flipped to Un-skip and toggled the oldest excused Occurrence — invisible in the card-only UI — and the user could never excuse incoming Occurrences in advance. A user with a daily cost off for a month had to press Skip once per day on each due date. We replaced the button with per-Occurrence controls and moved the recurring cards onto the Wallets/Categories row pattern (issue #93).

- Card rows now follow the #93 shape: tapping the main area jumps to the Transactions tab pre-filtered to that definition's linked Transactions (the shell's `LedgerFilterRequest` grows a recurring kind; the ledger's recurring filter already exists); a trailing ✎ button opens the edit modal. The red "N unpaid" badge stays the only Backlog signal (ADR-0025).
- The Skip/Un-skip button is gone: the backend `skip-toggle` endpoints and the derived `next_skip_action` field go with it, replaced by an Occurrence-list read per definition and per-Occurrence skip/un-skip writes.
- The edit modal gains an Occurrences section (edit mode only — a definition under creation has no id yet). Rows are non-Paid Occurrences only: Paid history lives in the ledger, and a Paid Occurrence can never be Skipped. Top to bottom: one live row — the next incoming (first future) Unpaid Occurrence; skipping it greys it and surfaces the following future one above it, so future Occurrences reveal one at a time and a whole month can be excused in one sitting; below, the past group (due today or earlier), today's row first, down to the oldest; excused rows stay greyed in date order with Un-skip, so every excused Occurrence stays reachable — paying a Skipped one still means un-skipping first (ADR-0016), now per row.
- The button's queue discipline (skip = oldest Unpaid, un-skip once the whole Backlog is excused) is gone: every row toggles independently, in any order.
- The state model is untouched: Skipped still never enters the Backlog, never counts toward Monthly Spendable, never links; un-skipping restores Unpaid; a skip anchors to its Occurrence's period and travels with it; deleting a definition still drops its skips. Recurring Incomes mirror everything (ADR-0011).

## Considered Options

- **Keep the button; let it keep skipping into the future** — rejected: one button cannot offer Skip and Un-skip at once. Making it walk past excused Occurrences makes un-skipping unreachable (the reason ADR-0016 flipped it), and keeping the flip caps future reach at one Occurrence — the bug we set out to fix.
- **A bulk "skip this month" control** — considered and dropped during grilling: the one-at-a-time top row already excuses a whole month in one sitting, and a window concept would have needed its own semantics.
- **Pause / a definition-level "off until" state** — rejected in ADR-0016, still rejected: different Backlog and Budget rules, and the user's need is per-Occurrence marks on known dates.
- **Show every future Occurrence in one chronological list** — the user picked reveal-one-at-a-time instead: it mirrors the pay order (the top row is the next one to pay) and keeps the list short.
- **Card tap keeps opening the edit modal** — rejected: recurring cards adopt the Wallets/Categories muscle memory (tap = see the record, ✎ = manage).

## Consequences

- API: `POST /recurring-costs/{cost_id}/skip-toggle` and `POST /recurring-incomes/{income_id}/skip-toggle` are removed and `next_skip_action` leaves the payloads; the Occurrences section reads the definition's Occurrences (dates with Unpaid/Skipped state, Paid excluded) and writes a per-date skip/un-skip.
- Tests that press the toggle (e.g. `test_repeated_toggles_clear_the_backlog_then_unskip`) rewrite against per-Occurrence calls.
- ADR-0016 remains the authority on the skip state model; its card-action decision and its rejection of a per-Occurrence list are superseded by this ADR.
