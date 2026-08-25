/** The client-side cache clock (ADR-0022): one global version number that
 * every successful write bumps, through the single transport seam. Mounted
 * tabs watch it with `useDataVersion()` and re-fetch when it changes, so a
 * tab switched back to is never stale — and never waits, because the
 * re-fetch happened in the background while the tab was hidden.
 *
 * The clock is deliberately global, not per-endpoint: in this app every
 * write can change every read (a Transaction changes Wallet balances, the
 * dashboard, the Budget, and the ledger), so a single version keeps the
 * rule simple and airtight. Read-only POST endpoints (the import
 * pipeline's computations) never bump: nothing was written, nothing can be
 * stale.
 */

import { useSyncExternalStore } from 'react'

let version = 0
const listeners = new Set<() => void>()

/** Tell every mounted tab that the Account's data changed on the server.
 * Called by the transport after a successful write (ADR-0022); tests call
 * it directly to simulate one. */
export function bumpDataVersion(): void {
  version += 1
  listeners.forEach((listener) => listener())
}

export function getDataVersion(): number {
  return version
}

export function subscribeDataVersion(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current data version, re-rendering the component when a write bumps
 * it — the dependency that makes a fetch effect re-run in the background. */
export function useDataVersion(): number {
  return useSyncExternalStore(subscribeDataVersion, getDataVersion)
}
