# Tabs stay alive; writes revalidate them

Switching tabs remounted the screen and refetched everything, so every tab
switch made the user wait on the spinner. The tabs now keep-alive: a tab
mounts on its first visit and stays mounted afterwards, hidden with the
`hidden` attribute — switching back renders instantly from the data already
loaded. Staleness is handled by a client-side cache clock: every successful
write through the transport bumps a global version, and every mounted tab
re-fetches in the background when it changes. A tab switched back to is
therefore never stale — and never waits, because the re-fetch happened while
it was hidden.

## The cache clock

- **One global version, not per-endpoint.** In this app every write can
  change every read: a Transaction changes Wallet balances, the dashboard,
  the Budget, and the ledger; a Category merge changes Transactions. A
  single version keeps the rule simple and airtight; the re-fetch cost of a
  write (a handful of small GETs per mounted tab) is invisible.
- **The transport is the single seam.** `request()` bumps the clock after
  any successful non-GET — no call site can forget. Failed writes never
  bump. The import pipeline's computation endpoints (`/import/preview`,
  `/import/validate-row`, `/import/revalidate-rows`) speak POST but write
  nothing, so they are exempt; without the exemption, every row edit during
  Verification would look like a write.
- **Screens subscribe with `useDataVersion()`** and list it among their
  fetch-effect dependencies. The effect re-runs in the background; the
  screen keeps rendering its loaded data meanwhile (the Dashboard's
  month-guard and the trend's kind-guard already prevented stale titles).
- **The Transactions ledger dedups its own writes.** A save/delete/import
  reloads explicitly (the tests' seam: the mocked API bypasses the
  transport, so the explicit reload is what tests exercise). The bump would
  then trigger the effect's reload a second time; the effect skips it when
  the explicit reload already covered the current version. Filter and
  search changes always reload — the version did not change then.
- **The Import Preview's on-resume re-check (issue #76) moved from
  remount to the clock.** The screen never remounts now, so the trigger is
  a write anywhere while a Preview is open: entities created in another tab
  flip the problem rows that waited on them, exactly as before.

## Considered Options

- **Refetch on tab activation only.** Pass an `active` prop down and refetch
  on every activation. Simpler, but every switch still fires the requests
  the user complained about — just non-blocking — and a tab revisited
  without any write refetches nothing it needs.
- **Mount every tab eagerly.** All screens load at sign-in, so the first
  visit to any tab is instant — at the price of fetching tabs the user may
  never open. Lazy keep-alive (mount on first visit) gets the same
  revisits-instant behavior without the upfront cost.
- **Cache responses in the API layer, invalidated per resource.** A
  keyed GET cache with explicit invalidation on writes. More machinery,
  more places to get the mapping wrong, and in this derived-data app every
  write touches nearly every read anyway — the global clock is the honest
  model.
- **Keep-alive without revalidation.** The tabs would show stale data after
  a write in another tab — a real regression for a finance app (a Wallet
  renamed in its tab, then a ledger read in another). Rejected.
- **Bump at write call sites instead of the transport.** Precise (only real
  writes), but spread across every resource module with no way to enforce
  completeness; the transport choke point is the repo's stated convention.
  The import exemption keeps the rule in one place.
