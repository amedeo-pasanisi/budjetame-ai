# Working in this repo

The conventions and test traps that the code and configs do not confess.
Layout, scripts and commands: read the directory tree, `backend/pyproject.toml`,
`frontend/package.json` and the README; this file only caches what a lookup
cannot give.

## Shape of a change

A behaviour change lands as one vertical slice per tier:

- **Backend**: the rule in `backend/app/services/<resource>.py` (raise a
  module-level exception), the wire shape in `backend/app/schemas.py`, the
  handler in `backend/app/<resource>.py` mapping the exception to a status
  (422 rule error with the message as `detail`, 409 name conflict, 403 for
  foreign *and* missing rows, ADR-0003), and the case in
  `backend/tests/test_<resource>.py`. Recurring Costs and Recurring Incomes
  are one module keyed by `Kind` (ADR-0033); a rule lands once there.
- **Frontend**: the call in `frontend/src/api/<resource>.ts`, re-exported from
  `frontend/src/api/index.ts` (the barrel every screen imports and every
  test mocks); for Recurring, also the per-side binding in
  `frontend/src/recurringSide.ts`. A screen is a trio: `<X>Screen.tsx`
  (list, state), `<X>Modal.tsx` (shell), `<X>Form.tsx` (fields, actions,
  inline errors). Every user-facing string goes in
  `frontend/src/i18n/catalogs.ts` in both `enMessages` and `itMessages`.
- **Docs**: cite the ADR or issue in the docstring or comment of what you
  add; amend `CONTEXT.md` terms and rules; add the change to `CHANGELOG.md`
  under Unreleased. ADRs are numbered in order; two share `0024`.

Module-level docstrings and comments explain the *why* with the ADR number;
match that register.

## Backend tests

- The seam is HTTP: tests call the app through `httpx`; `app.services` is
  never imported from a test.
- One Postgres per session, never cleaned between files: every name a test
  creates (Wallet, Category, definition) must be unique across the whole
  suite, or a 409 appears only in the full run. Prefix fixture names with the
  test's topic.
- The ledger list is paginated (default page size in
  `backend/app/transactions.py`); read a Transaction back through a filter
  (`?wallet_id=`) rather than scanning the first page.
- Per-file suites take 25–45 s, the whole suite about 4 min; run files while
  iterating and the whole suite once at the end, in the background.

## Frontend tests

- `vi.mock('./api', …)` replaces the barrel with a literal object: every
  export the rendered tree touches must be listed, including what a
  provider or modal below the screen calls (the undo provider calls every
  kind's undo). A missing key fails only when reached.
- Vitest globals are off: import `describe`/`it`/`vi` from `vitest`. Render
  through `src/test/renderWithIntl.tsx`; pass `{ locale: 'it' }` to assert
  Italian.
- Screens read the token with `localStorage.getItem(TOKEN_KEY) ?? ''`, so
  mocks are called with `''`; the Settings restore flow returns early without
  a token, so set one when driving it.
- The Recurring tab remembers its side at module level
  (`frontend/src/recurringSide.ts`); a suite that opened the Incomes side
  leaves it there for later cases in the same file — call
  `setRecurringSide('costs')` in `beforeEach`.
- Collapsible sections (Frozen lists) keep their expanded state across list
  updates; check `aria-expanded` before clicking a header a second time.
- Anything with a toast or app-wide state lives in a provider rendered by the
  app shell (`frontend/src/App.tsx`); to observe it from a screen test, wrap
  the screen in that provider.
