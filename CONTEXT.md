# Budjetame

A single-user personal finance app. Money lives in Wallets; every balance is derived from the Wallet's transaction history, and Net Worth is the sum of all Wallet balances.

## Language

**Account**:
The single login identity in the system, seeded at setup. There is no registration path.
_Avoid_: user, profile

**Wallet**:
Any money-holder in the system. Four types: Checking, Credit Card, Cash, Contact.
_Avoid_: account, bank account

**Contact Wallet**:
A Wallet that represents a person or organization whose debts with the user are tracked (e.g. "Marco"). A positive balance means they owe you; a negative one means you owe them. Money moves in and out only via Transfers.
_Avoid_: third-party account, friends account, IOU

**Transaction**:
A dated money movement recorded on one or two Wallets. Types: Expense, Income, Transfer, Opening Balance.
_Avoid_: entry, movement, operation, record

**Expense**:
A Transaction that decreases a Wallet's balance — money leaves the user's control.
_Avoid_: spending, outgoing, payment

**Income**:
A Transaction that increases a Wallet's balance — money comes into the user's control.
_Avoid_: earning, incoming, deposit

**Transfer**:
A Transaction that moves money from a Source Wallet to a Destination Wallet. Net Worth never changes, it never carries a Category, and the source and destination must be different Wallets.
_Avoid_: internal transfer, move

**Recurring Cost**:
A definition of a cost expected to repeat at a fixed interval (every N days, weeks, months, or years), with a name, a fixed amount, and a Wallet. It produces derived Occurrences; each payment is still recorded by hand as a linked Expense — the app never creates Transactions on its own.
_Avoid_: monthly cost, fixed cost, subscription, recurring transaction

**Occurrence**:
One derived due instance of a Recurring Cost, computed from its start date plus k×interval (an unset start date defaults to the creation date). Each Occurrence is either Paid — exactly one linked Expense covers it — or Unpaid. Its due date is its own date, unless the cost's optional override (day-of-month for months, month+day for years) shifts it.
_Avoid_: instance, cycle, due event

**Backlog**:
A Recurring Cost's Unpaid Occurrences whose due date is today or earlier — the "N unpaid" badge on the Recurring Costs screen. A cost with a Backlog shows Overdue.
_Avoid_: arrears, overdue list

**Category**:
A user-defined label that groups Transactions of one type. Each Category is either expense-only or income-only and can only be attached to Transactions of that type. Names are unique case-insensitively within their type: an expense "Food" and an income "Food" can coexist.
_Avoid_: tag, label, group

**Description**:
A free-text note a user attaches to a Transaction, optional and up to 500 characters. A blank or missing description is treated as the same value (e.g. by import duplicates).
_Avoid_: note, memo, reference

**Duplicate**:
An import row that matches an existing Transaction, or an earlier row of the same file, on date, amount, type, wallet(s), category, and description (Transfers key on date, amount, source and destination Wallets, and description). Duplicates are skipped by the import unless the row is verified into a different key.
_Avoid_: repeated row, double entry

**Merging**:
The outcome of renaming a Category to the name of an existing Category of the same Type: the existing Category survives with its name, icon, and color; the renamed Category's Transactions move to it; the renamed Category is deleted. A rename that collides merges instead of failing.
_Avoid_: combining, renaming-into

**Balance**:
The current amount of a Wallet, always computed as the sum of its Transactions, never stored.
_Avoid_: stored balance, ledger balance

**Net Worth**:
The algebraic sum of the balances of all Wallets, including Contact Wallets and frozen ones (always €0). Transfers never change it.
_Avoid_: total assets, equity

**Frozen Wallet**:
A Wallet deleted at balance exactly €0. It stays in the database with its Transactions viewable; while frozen it is read-only — no Transactions can be created, edited, or deleted on it — and it appears only in the Wallets screen's collapsed Frozen Wallets list. Unfreezing restores it to active: it returns to its type section, accepts Transactions again, and its existing Transactions become editable again.
_Avoid_: deleted wallet, trashed wallet, archived wallet

**Opening Balance**:
A Transaction created when a Wallet is started with a nonzero initial balance (must be ≥ €0). It counts toward the Wallet's balance but never toward income/expense statistics.
_Avoid_: initial transaction, seed entry

**Geographic Location**:
An optional set of coordinates (latitude/longitude) attached to a Transaction, optionally carrying a Place reference. The maps link is built on the frontend from the Place when present, else from the coordinates; the link itself is never stored as text.
_Avoid_: maps link, location text

**Place**:
A named spot on the map (e.g. "Esselunga") that a Geographic Location may carry alongside its coordinates, together with an optional provider-specific reference ID (e.g. a Google place_id). Only a name-search pick or a tap on the Google map produces a Place; Leaflet taps, GPS, and imports attach coordinates alone. Google's map UI calls them points of interest (POIs); the provider API and the stored reference ID use the word place (place_id).
_Avoid_: address, venue, POI

**Import Draft**:
The unconfirmed state of an import: the parsed rows, verification edits, and row selections, kept while the user leaves the Import screen. It is discarded only by Cancel, picking another file, or a successful import.
_Avoid_: pending import

**Preview**:
The review step of an import before anything is written: every row is classified ready, duplicate, or problem, and can be verified. Nothing reaches the database until the import is confirmed.
_Avoid_: verification phase

**Verification**:
The act of editing a Preview row — date, amount, type, wallet(s), category, description, location — so it becomes acceptable for import. A verified row is re-validated against the database as it is saved.
_Avoid_: fixing rows

## Rules

- The only supported currency is EUR.
- Cash Wallets may go negative, but any write that would do so shows a warning. Checking, Credit Card, and Contact Wallets can go negative without a warning.
- Contact Wallets participate only in Transfers — never direct Expense/Income Transactions.
- Wallet names are unique per Account, case-insensitively. A Wallet's name can be edited after creation; its type cannot.
- A Wallet can only be frozen when its balance is exactly €0.
- A Frozen Wallet can be unfrozen at any time: its balance is always exactly €0 while frozen.
- A Place is attached to a Geographic Location by a name-search pick or a tap on the Google map; a coordinates-only pick (Leaflet tap, GPS), an import, or removing the Location clears it.
- An import row is a Duplicate when date, amount, type, wallet(s), category, and description all match an existing Transaction or an earlier row of the same file; a blank description matches a missing one.
- Searching the ledger matches Transactions whose Description contains the needle, case-insensitively (accents must match exactly), combined with any other filters.
- Transaction dates are stored as UTC timestamps; months and years for reporting are bucketed in Europe/Rome, the app's single fixed timezone.
- Recurring Costs are expense-side only and may be created only on active, non-Contact Wallets.
- An Expense links to at most one Recurring Cost; linking pays exactly one Occurrence, the oldest Unpaid one, pinned at link time and never reassigned by later date edits. Unlinking or deleting the Expense frees the Occurrence.
- Recurring Cost names are unique per Account, case-insensitively.
- Deleting a Recurring Cost severs the links: linked Expenses remain as ordinary Expenses.
- Occurrences and Backlog are always derived from the definition; editing interval or start date reshapes only the derived future.
- Imports never set the link.
- All data is scoped to the single Account; foreign data gets a 403.

## Non-goals

- Registration and multi-user accounts
- Auto-generated transactions: the app never creates them — Recurring Costs are tracking-only; budgets (budgets may come later)
- Multi-currency
- Bank sync via GoCardless (deferred to a later milestone)
- Data export
