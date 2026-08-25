# Changelog

All notable changes to Budjetame. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/). The version the app itself reports is the
`v1.0.0` tag this file is released with.

## [v1.0.0] — 2026-08-25

First release. The full v1 feature set, verified by 444 backend tests, the
frontend test suite, and a production build. Tagged on the commit standing
behind the live deployment at budjetame.de.

### Added

- **Wallets** — CRUD for Checking, Credit Card, Cash, and Contact Wallets;
  Opening Balance transactions; every balance derived from the Wallet's
  transaction history, never stored; Net Worth as the sum of all balances;
  wallet sections by type with signed balances; freeze and unfreeze with
  read-only enforcement on frozen wallets (ADR-0002).
- **Transactions** — Expense, Income, and Transfer transactions; Transfers
  with Contact Wallet IOUs (ADR-0017); per-wallet history with filters;
  search by description keyword; cursor pagination and infinite scroll on the
  Transactions tab; Transaction form as a modal with inline creation of
  Categories, Wallets, and Recurring definitions from the selects.
- **Dashboard** — summary with Net Worth and month income vs. expenses;
  expense and income pie chart with reference month/year filter; monthly
  trend chart with a user-picked month range; toggle between Expenses and
  Incomes.
- **Categories** — CRUD; grouped sections, search, and a bottom-sheet modal;
  rename collisions merge instead of failing; merge confirm flow;
  uncategorize-on-delete.
- **Recurring** — Recurring Cost and Recurring Income definitions with
  derived Occurrences; linked Expenses/Incomes; Backlog, Overdue, and summary
  lines; skip occurrences (ADR-0016); definitions carry no Wallet or
  Category — those are chosen per payment (ADR-0015).
- **Locations** — geographic location with map picker and GPS prefill; Place
  reference fields end-to-end on the Transaction form; Leaflet/OpenStreetMap
  by default with a Google Maps provider switch (Places search); session
  opt-out for location prompts.
- **Import & Export** — Excel/CSV import with preview, duplicate detection,
  per-row re-validation, inline entity creation, and transactional confirm;
  Excel export of the filtered ledger in the import template format.
- **Accounts & access** — email+password registration; Google sign-in with
  auto-provisioned Accounts; password reset by email with single-use tokens;
  self-service account deletion; JWT authentication; every query scoped by
  Account with 403s for foreign data (ADR-0020, ADR-0021).
- **Platform** — Oracle Cloud Always Free deployment (Docker stack,
  provisioning wizard, pure-Python OCI client); HTTPS via Caddy
  (ADR-0018, ADR-0019); GitHub Actions CI/CD building native platform images
  per environment (dev/stage/prod).

### Changed

- Multi-user auth superseded the original single-user design: the seeded
  administrator Account is now one ordinary Account among many (ADR-0003 →
  ADR-0020).
- Recurring definitions carry no Wallet or Category (ADR-0015) — the
  originally planned fixed Wallet/Category was dropped after grilling.
- Dashboard month handled as a value type; import creation rules live in the
  transaction module; single ownership/name-availability module (refactors
  after the first tracer-bullet pass).

### Fixed

- Balance preview excluded the edited transaction itself.
- Cash-warning contract narrowed to writes and deletes, never reads.
- Transaction form never offers frozen wallets.
- Mobile Maps app opens the tapped place, not a literal `place_id` search.
- Google ID-token verification used the wrong transport — TypeError → 500 on
  the sign-in button.
- Wizards wrote to the wrong `.env` — the library's CWD-relative default
  swallowed the override.
- De-flaked TransactionsScreen sentinel tests (IntersectionObserver flush
  timing).
- Tabs keep alive once visited and revalidate in the background (ADR-0022).

[v1.0.0]: https://github.com/amedeo-pasanisi/budjetame-ai/releases/tag/v1.0.0
