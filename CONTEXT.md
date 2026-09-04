# Budjetame

A personal finance app where each person has their own Account. Money lives in Wallets; every balance is derived from the Wallet's transaction history, and Net Worth is the sum of all Wallet balances.

## Language

**Account**:
A person's login identity and personal data space. Created by email+password registration or by a first Google sign-in (auto-provisioned). All data is scoped to the Account that owns it — no Account can see or touch another's.
_Avoid_: user, profile

**Wallet**:
Any money-holder in the system. Four types: Checking, Credit Card, Cash, Contact.
_Avoid_: account, bank account

**Contact Wallet**:
A Wallet that represents a person or organization whose debts with the user are tracked (e.g. "Marco"). A positive balance means they owe you; a negative one means you owe them. Money moves in and out via Transfers, and an Expense on it records consumption the contact paid for.
_Avoid_: third-party account, friends account, IOU

**Transaction**:
A dated money movement recorded on one or two Wallets. Types: Expense, Income, Transfer, Opening Balance.
_Avoid_: entry, movement, operation, record

**Expense**:
A Transaction that decreases a Wallet's balance — money leaves the user's control, or, on a Contact Wallet, the contact paid for the user's consumption.
_Avoid_: spending, outgoing, payment

**Income**:
A Transaction that increases a Wallet's balance — money comes into the user's control.
_Avoid_: earning, incoming, deposit

**Transfer**:
A Transaction that moves money from a Source Wallet to a Destination Wallet. Net Worth never changes, it never carries a Category, and the source and destination must be different Wallets.
_Avoid_: internal transfer, move

**Recurring Cost**:
A definition of a cost expected to repeat at a fixed interval (every N days, weeks, months, or years), with a name and a fixed amount. It produces derived Occurrences; each payment is still recorded by hand as a linked Expense, whose Wallet and Category are chosen at Transaction creation time — the definition itself never carries them. The app never creates Transactions on its own.
_Avoid_: monthly cost, fixed cost, subscription, recurring transaction

**Recurring Income**:
A definition of an income expected to repeat at a fixed interval (every N days, weeks, months, or years), with a name and a fixed amount. It produces derived Occurrences; each receipt is still recorded by hand as a linked Income, whose Wallet and Category are chosen at Transaction creation time — the definition itself never carries them. The app never creates Transactions on its own.
_Avoid_: recurring earning, paycheck, salary entry

**Occurrence**:
One derived due instance of a Recurring Cost or Recurring Income, computed from the definition's start date plus k×interval (k = 0 is the start date itself). Its due date is its own date. Every definition has a start date: one left empty at creation is set to the creation day, so a fresh definition's first Occurrence is its creation day; afterwards the date can only be changed, never unset (ADR-0024). Each Occurrence is either Paid — exactly one linked Transaction of the matching type (an Expense for a Cost, an Income for a Recurring Income) covers it — Unpaid, or Skipped: the user marked it as not applying, so it never enters the Backlog, never counts toward Monthly Spendable, and a link can never cover it. Un-skipping restores it to Unpaid.
_Avoid_: instance, cycle, due event

**Backlog**:
A Recurring Cost's or Recurring Income's Unpaid, un-Skipped Occurrences whose due date is today or earlier — the red "N unpaid" badge on the Recurring screen. A definition with a non-empty Backlog shows that badge.
_Avoid_: arrears, overdue list, overdue

**Budget**:
The per-month spending frame that answers "how much can I spend today": each day the Daily Allowance accrues into Spendable Today and Discretionary Expenses drain it. Each month is its own frame — the Budget resets on the 1st. It is purely derived from Recurring definitions and Transactions, never stored, and recomputes retroactively when they change.
_Avoid_: allowance, daily budget, pocket money

**Monthly Spendable**:
A month's Budget total: the sum of the Recurring Income Occurrences due in that month minus the sum of the Recurring Cost Occurrences due in it, counted by due date whether paid or not — Skipped ones never count. When negative, the Daily Allowance floors at 0.
_Avoid_: monthly available, free money, disposable income

**Daily Allowance**:
The Monthly Spendable divided by the number of days in the month, floored to the cent, with the leftover remainder landing on the last day of the month. One unit accrues into Spendable Today per calendar day.
_Avoid_: daily amount, per-day budget, daily rate

**Spendable Today**:
The Budget bucket right now: the Daily Allowances accrued from the 1st through today minus the Discretionary Expenses dated in that span. It may go negative — future accruals repay the debt — and while negative it is shown as 0. Resets to 0 on the 1st of each month.
_Avoid_: available today, remaining budget, balance left

**Discretionary Expense**:
An Expense that does not pay a Recurring Cost Occurrence — i.e. it is not linked to a Recurring Cost. The only thing that drains Spendable Today.
_Avoid_: free spending, unlinked expense, fun spending

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
The review step of an import before any Transaction is written: every row is classified ready, duplicate, or problem, and can be verified. Wallets and Categories created from the row editor during the Preview are real immediately — only Transactions wait for the import's confirmation.
_Avoid_: verification phase

**Revalidation**:
Re-running a Preview row through the import's resolution and rules: as one edited row is saved, as every problem row is re-checked when the Preview resumes, and as the problem rows referencing a Wallet or Category created from the row editor are re-validated in one batch. A row that re-validates flips to Ready, Duplicate, or a Problem with its message narrowed to what remains.
_Avoid_: re-check, refresh, re-scan

**Verification**:
The act of editing a Preview row — date, amount, type, wallet(s), category, description, location — so it becomes acceptable for import. A verified row is re-validated against the database as it is saved.
_Avoid_: fixing rows

**Export**:
A generated .xlsx of the Account's Transactions in the import template's format, downloaded from the ledger with the current filters and search applied. It carries only what the template carries: Opening Balance Transactions are left out (the template's type vocabulary has no value for them), Recurring links are never carried, and Places flatten to coordinates. Re-importing an Export into the same Account flags every row as a Duplicate; into a fresh Account it restores the ledger once its Wallets and Categories exist.
_Avoid_: backup, dump, statement

**Ledger jump**:
What a Wallet, Category, or Recurring definition row's whole-surface tap does: it opens the Transactions tab with the ledger already filtered to exactly that Wallet, that Category, or — for a Recurring Cost or Recurring Income — that definition's linked Transactions — the previous filters, search, and open Filters panel are all reset by the jump, and a Frozen Wallet's history lands read-only. Editing the row is the card's separate trailing Edit button, never the tap itself.
_Avoid_: transactions filtering on card tap, row-tap filter, filter shortcut

## Rules

- The only supported currency is EUR.
- Cash Wallets may go negative, but any write that would do so shows a warning. Checking, Credit Card, and Contact Wallets can go negative without a warning.
- Contact Wallets move money via Transfers and as the Wallet of an Expense (consumption the contact paid for); never as the Wallet of an Income.
- Wallet names are unique per Account, case-insensitively. A Wallet's name can be edited after creation; its type cannot.
- A Wallet can only be frozen when its balance is exactly €0.
- A Frozen Wallet can be unfrozen at any time: its balance is always exactly €0 while frozen.
- A Place is attached to a Geographic Location by a name-search pick or a tap on the Google map; a coordinates-only pick (Leaflet tap, GPS), an import, or removing the Location clears it.
- An import row is a Duplicate when date, amount, type, wallet(s), category, and description all match an existing Transaction or an earlier row of the same file; a blank description matches a missing one.
- Searching the ledger matches Transactions whose Description contains the needle, case-insensitively (accents must match exactly), combined with any other filters.
- Transaction dates are stored as UTC timestamps; months and years for reporting are bucketed in Europe/Rome, the app's single fixed timezone.
- Recurring Costs and Recurring Incomes carry no Wallet and no Category: the Wallet and Category of a linked Transaction are chosen at Transaction creation time.
- An Expense links to at most one Recurring Cost; linking pays exactly one Occurrence, the oldest Unpaid one — never a Skipped one; un-skipping comes first — pinned at link time and never reassigned by later date edits. Unlinking or deleting the Expense frees the Occurrence. An Income links to at most one Recurring Income under the same contract.
- Recurring Cost names are unique per Account, case-insensitively; Recurring Income names are unique the same way.
- Deleting a Recurring Cost severs the links and drops its skips: linked Expenses remain as ordinary Expenses. Deleting a Recurring Income severs the links and drops its skips: linked Incomes remain as ordinary Incomes.
- A skip is anchored to its Occurrence's period — the month for a monthly definition, the year for a yearly one, the date itself for daily and weekly ones — and travels with the Occurrence: editing the definition never drops it, and changing the interval unit maps the period along (a skipped month becomes its year, a skipped year becomes its month). A skip whose period holds no Occurrence lies dormant; only un-skipping removes it.
- Occurrences and Backlog are always derived from the definition; editing interval or start date reshapes only the derived future.
- A Recurring definition never carries a due-day or due-date override (ADR-0024): every Occurrence is due on its own date, the definition's only date is the start date, and one left empty at creation is set to the creation day.
- The Budget is always derived, never stored: editing a Recurring definition, a Transaction, or a link recomputes Monthly Spendable, Daily Allowance, and Spendable Today retroactively from the 1st of the month.
- Monthly Spendable counts Occurrences by due date, paid or not — Skipped ones never count; Expenses linked to a Recurring Cost never drain Spendable Today, and one-off Incomes never fill it.
- Each month's Budget starts fresh at 0; Spendable Today may go negative within the month and is displayed as 0 until future accruals repay it.
- Imports never set the link.
- An Export never carries the link either: an exported row has no Recurring link and no Place — coordinates only — and Opening Balance Transactions are not exported.
- All data is scoped to its owning Account; foreign data gets a 403.

## Non-goals

- Email verification: signups are trusted without a confirmation email — identity proof is the password itself, a password reset, or Google's verified email
- Auto-generated transactions: the app never creates them — Recurring Costs and Recurring Incomes are tracking-only
- Multi-currency
- Bank sync via GoCardless (deferred to a later milestone)
