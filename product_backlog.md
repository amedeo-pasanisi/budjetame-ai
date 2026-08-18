# PRODUCT BACKLOG: Personal Finance App

### DEFINITION OF DONE

*Each User Story listed below is considered "Done" only if:*

1. The backend (BE) code (FastAPI) is written and passes the automated tests.
2. The frontend interface (FE) (React) is functional and perfectly adapts to a mobile phone screen (Mobile-First).
3. There are no blocking errors in the console.

---

### EPIC 1: Security and Access

**US 1.1 - Environment and Database Setup**
* **Story:** As a developer, I want to configure the base project with FastAPI, React, and PostgreSQL so that I can start developing the features.
* **Acceptance Criteria:**
  * A PostgreSQL instance is operational and configured via a container (e.g. Docker Compose) with volumes set up for data persistence.
  * FastAPI backend configured to connect to the database via ORM (e.g. SQLAlchemy).
  * Tool for managing database migrations (e.g. Alembic) installed and configured.
  * FastAPI API exposes a working health-check (ping) endpoint.
  * React app initialized and able to render a basic page, with a "Mobile-First" CSS framework (e.g. Tailwind CSS) configured.

**US 1.2 - Registration and Login**
* **Story:** As a user, I want to be able to log in with email and password, and have my financial data protected from external access.
* **Acceptance Criteria:**
  * The app is single-user: exactly one Account is seeded into the DB (the "administrator"). There is no registration path and no user creation from the FE.
  * JWT-based authentication.
  * The login endpoint must be functional.
  * If I enter an invalid email, the system must return a format error.
  * If I try to access the frontend pages without being authenticated, I am redirected to the login page.
  * The password stored in the DB must be obscured (hashed).

**US 1.3 - Data Isolation**
* **Story:** As an authenticated user, I want to be able to view and modify only my own data, so that my privacy is guaranteed.
* **Acceptance Criteria:**
  * Every query is scoped by Account id. If I attempt to call the APIs requesting the ID of a wallet belonging to another hypothetical Account, the system must return a "403 Forbidden" error.

**US 1.4 - Location Saving**
* **Story:** As a user, I want to be asked for permission before saving the location where my transactions take place so that my privacy is maintained.
* **Acceptance Criteria:**
  * When I save a transaction for the first time, I am asked for permission to access the device's location.

---

### EPIC 2: Wallet Management

**US 2.1 - Wallet Creation**
* **Story:** As a user, I want to be able to create a new wallet by choosing the type (Checking Account, Credit Card, Cash, Contact Wallet), so that I can track its balance.
* **Acceptance Criteria:**
  * Wallet types: Checking Account, Credit Card, Cash, Contact Wallet.
  * The default initial balance when creating a wallet is €0.00. A nonzero opening balance may be set at creation: it is recorded as an "Opening Balance" transaction, must be ≥ €0, and never counts toward income/expense statistics.
  * **Cash**: the balance may go negative, but any write (create, edit, transfer, import) that would make it negative shows a warning. Checking Account, Credit Card, and Contact Wallets may go negative without a warning.
  * The only currency supported by the system is the euro (€, EUR).
  * Wallet names are unique per Account, case-insensitively. A wallet's name can be edited after creation; its type cannot.

**US 2.2 - Wallet Deletion (Freeze)**
* **Story:** As a user, I want to delete a wallet that I no longer use without losing the history of old transactions, so that it does not clutter my list of wallets.
* **Acceptance Criteria:**
  * A wallet can only be deleted (frozen) when its balance is exactly 0.
  * When I delete a wallet, the interface no longer displays it, but it remains present in the DB and all transactions made on that wallet are still viewable.
  * A frozen wallet is read-only: no new transactions can be created on it, and its existing transactions can no longer be edited or deleted. Its balance therefore stays €0 and Net Worth is unaffected.

**US 2.3 - Unfreezing Frozen Wallets**
* **Story:** As a user, I want to unfreeze a frozen wallet, so that a mistaken freeze or a change of heart is reversible (issue #48).
* **Acceptance Criteria:**
  * The Wallets screen shows a collapsed "Frozen wallets (N)" footer row (absent when N = 0); tapping it expands the frozen list in place.
  * Frozen rows read like active rows — name, "Type · Frozen" subtitle, unsigned €0.00 — sorted A→Z case-insensitively in one flat list.
  * The whole frozen row is the Unfreeze button: one tap, no confirmation. The wallet leaves the Frozen list and lands in its type section at its sorted position; the footer row disappears when the last frozen wallet is unfrozen.
  * An unfrozen wallet behaves exactly as if never frozen: its Transactions become editable again, and rename/re-freeze work.
  * The name rule is unchanged: a frozen wallet still holds its name, and name-collision messages stay as they are.

---

### EPIC 3: Transaction Management

**US 3.1 - Expense or Income Transaction**
* **Story:** As a user, I want to record an expense or income by mandatorily specifying "Date", "Amount", "Wallet" and optionally, "Category", "Description", "Geographic Location", so that I can track my cash flows.
* **Acceptance Criteria:**
  * If I leave one of the mandatory fields empty, the "Save" button does not work.
  * The date field is populated by default with today's date (Europe/Rome) and can be edited to any date.
  * Upon saving, the balance of the associated wallet must be updated instantly (e.g. Previous balance €100, I enter an Expense of €20 -> New balance €80). Balances are derived from the transaction history, so editing or deleting a transaction updates balances automatically.
  * If the write would make a Cash wallet's balance negative, a warning is shown (still allowed).

**US 3.2 - Google Maps Location Saving**
* **Story:** As a user, I want to record the location of my transactions so that I can remember and track my movements.
* **Acceptance Criteria:**
  * The "Geographic Location" field stores coordinates (latitude/longitude) and, when a place was chosen by name search or by tapping the Google map, that place's name and Google place_id (ADR-0005). The maps link is built on the frontend — from the place_id, else the name, else the coordinates — and the link itself is never stored as text. Re-picking by a coordinates-only pick (Leaflet tap or GPS), or removing the location, clears the place.
  * When I create a transaction, if the system has permission to access GPS, the "Geographic Location" field is populated by default with my current coordinates.
  * When I tap "Use my location", the button shows a locating state until the position is found; if it fails (denied, timeout, unavailable), an inline message tells me and the map picker remains available.

**US 3.3 - Transaction Editing/Deletion**
* **Story:** As a user, I want to edit or delete a transaction so that the accounts match reality.
* **Acceptance Criteria:**
  * Because balances are derived, saving or deleting a transaction automatically recalculates the balances of the wallets involved — no manual recalculation.
  * Transactions belonging to a frozen wallet can neither be edited nor deleted.

**US 3.4 - Internal Transfer Transaction**
* **Story:** As a user, I want to record a transfer of money from one of my wallets to another, so that I can move funds (e.g. pay the card or withdraw cash) without affecting spending statistics.
* **Acceptance Criteria:**
  * The transfer form requires a "Source Wallet" and a "Destination Wallet", which must be different wallets.
  * The operation does not require a Category but is internally tagged as "transfer".
  * Total Net Worth must not change after this operation.
  * Contact Wallets participate only in Transfers: money moves in and out of them exclusively via transfers, never via direct Expense/Income transactions.

**US 3.5 - Transaction History (merged into the Transactions tab)**
* **Story:** As a user, I want to browse my transactions, so that I can find, edit, and delete them.
* **Acceptance Criteria:**
  * The Transactions tab lists transactions newest-first with infinite scrolling (cursor-based paging, 50 per page).
  * A collapsible filter bar narrows the list by wallet (including frozen wallets, marked "Frozen"), date range, and category; unfiltered, the list shows all transactions.
  * Uncategorized expenses are labeled "Uncategorized".
  * Entry points for editing and deleting transactions from the list (except transactions of frozen wallets).
  * The former History tab is removed; its capabilities live in the Transactions tab.

---

### EPIC 4: Category Management

**US 4.1 - Category CRUD**
* **Story:** As a user, I want to be able to create, edit, or delete my categories, to customize how I group my expenses and incomes.
* **Acceptance Criteria:**
  * I can create a category by specifying a Name, an Icon/Color, and a Type: expense-only or income-only. A category can only be attached to transactions of its type.
  * I cannot create two categories with the exact same name within a type (case-insensitive): an expense "Food" and an income "Food" can coexist.
  * Renaming a category to the name of an existing same-type category merges them (ADR-0007): the existing category survives with its name, icon, and color, the renamed category's transactions move to it, and the renamed category is deleted. The rename shows a confirmation with the transaction count before the merge happens.
  * Deleting a category leaves its transactions uncategorized; transactions are never deleted.
  * Transfers never carry a category.

---

### EPIC 5: Debt and Credit Management (IOU)

**US 5.1 - Tracking Loans to Friends**
* **Story:** As a user, I want to use the "Transfer" function to a "Contact Wallet", so that I can record a receivable from a friend.
* **Acceptance Criteria:**
  * When I transfer €50 from my Checking Account to the "Marco" Wallet, the "Marco" Wallet increases to +€50 (credit in my favor).
  * The positive/negative balance of Contact Wallets contributes to the Net Worth calculation.

**US 5.2 - Wallets Screen Sections (Who Owes Me)**
* **Story:** As a user, I want the Wallets screen grouped into sections by type — Contacts first — each sorted alphabetically with signed balances, so that I can see at a glance who owes me money and whom I owe (issue #47).
* **Acceptance Criteria:**
  * Four sections, fixed order, styled like the Categories tab sections: Contacts, Checking Accounts, Credit Cards, Cash. A section with no wallets is hidden; the row appearance is unchanged.
  * Each section is sorted A→Z case-insensitively; settled contacts (€0.00) stay visible.
  * Every balance carries a sign in the transaction-amount convention: `+€50.00` / `-€30.00` / `€0.00` unsigned.
  * Debts are Contact Wallets only: credit cards and other types are accounts, never debt parties.
  * Frontend-only change: no backend, schema, or migration work; no search bar, no subtotals, no Dashboard changes.

---

### EPIC 6: Dashboard and Reporting

**US 6.1 - Main Dashboard**
* **Story:** As a user, as soon as I open the app I want to see my Net Worth and a summary of the month's Income/Expenses, so that I have an immediate overview of my finances.
* **Acceptance Criteria:**
  * Net Worth calculates the algebraic sum of all wallets (including frozen ones, which are always €0, and Contact Wallets).
  * A progress bar or text is displayed comparing the month's Income vs Expenses.

**US 6.2 - Category Pie Chart**
* **Story:** As a user, I want to see a pie chart, so that I can immediately understand which categories are costing me the most this month.
* **Acceptance Criteria:**
  * The chart correctly sums all expenses associated with a specific category in the current month.
  * Uncategorized expenses appear in an "Uncategorized" slice, so the pie always sums to the month's total expenses.

**US 6.3 - History and Time Filters**
* **Story:** As a user, I want to be able to change the reference month or year in the dashboard, so that I can compare my past habits.

**US 6.4 - Expense Comparison Over Time**
* **Story:** As a user, I want to see a chart showing the trend of my expenses over a period of time so that I can identify trends or anomalies (e.g. I have been spending more lately).
* **Acceptance Criteria:**
  * Bar or line chart (Bar chart / Line chart). X-axis: Months. Y-axis: Total Expenses.
  * The user selects a time range (start/end date picker) from the frontend; the chart buckets expenses by month within that range.

---

### EPIC 7: Data Integrations and Import

**US 7.1 - Excel Import**
* **Story:** As a user, I want to upload a standardized Excel file, so that I can import dozens of transactions at once.
* **Acceptance Criteria:**
  * File upload interface for .xlsx or .csv files where data extraction takes place.
  * Owned template, one flat sheet, amounts always positive — columns: `date`, `type` (expense | income | transfer), `amount`, `wallet`, `source wallet`, `destination wallet`, `category`, `description`, `location`.
  * Expense/Income rows: `wallet` + `category` (matching the category's type). Transfer rows: `source wallet` + `destination wallet`, no `wallet`, no `category`.
  * Wallets are matched by name (unique per Account); unknown names are rejected before the confirmation step.
  * Duplicate rows (compared against the DB) are displayed in yellow: expense/income key = date + amount + type + wallet + category + description; transfer key = date + amount + source + destination + description (ADR-0006). A blank description matches a missing one.
  * The user confirms before the transactions are added to the DB.

**US 7.2 - Balance Checking via Banking APIs** *(DEFERRED — later milestone)*
* **Story:** As a user, I want to connect the system to GoCardless, so that the system can read my actual bank balances.
* **Acceptance Criteria:**
  * The system allows the actual balance to be read and generates an alert if the balance calculated by the system differs from the actual balance.
* **Note:** Deferred because its acceptance criteria depend on external parties (GoCardless + bank consent/PSD2) that block the Definition of Done. The derived-balance model already keeps the comparison trivial to add later.

---

### OUT OF SCOPE FOR v1

- Registration and multi-account (the app is single-user).
- Recurring transactions.
- Budgets (may be implemented in the future).
- Multi-currency.
- Bank sync via GoCardless (deferred — see US 7.2).
- Data export.
