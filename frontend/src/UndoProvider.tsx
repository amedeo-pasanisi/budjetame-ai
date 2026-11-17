/** The app-wide Undo stack (ADR-0031, lifted to the app shell by
 * ADR-0034): one stack of deleted entities — Transactions, Frozen Wallets,
 * frozen Recurring definitions — one cap of three across every kind, one
 * 10-second window, one toast stack visible on every tab. Tabs are kept
 * alive (ADR-0022), so a per-screen stack would have survived a tab switch
 * while hiding its toast; here the shell owns the stack and the Undo
 * handler, and the screens only report what they deleted and take back
 * what Undo restored.
 *
 * The seam is the context (undoContext.ts): `useUndo()` gives a screen
 * `pushDeleted` (report a delete — its toast appears) and `restored` (the
 * entity the last successful Undo brought back, for the owning screen to
 * put back in its list), and gives the shell `clear` (a Restore wipes every
 * pending undo, ADR-0030). This file holds the provider that owns the
 * stack, the expiry timer, the Undo handler and the toast stack. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useIntl } from 'react-intl'

import {
  ApiError,
  TOKEN_KEY,
  undoRecurringCostDelete,
  undoRecurringIncomeDelete,
  undoTransaction,
  undoWalletDelete,
} from './api'
import {
  clearStack,
  entryKey,
  expireEntries,
  pushEntry,
  removeEntry,
  type DeletedEntity,
  type UndoEntry,
} from './undoStack'
import { UndoContext, type RestoredEntity } from './undoContext'
import { UndoToastStack } from './UndoToastStack'

/** Replay an entry through its kind's undo endpoint: the very same entity
 * comes back — same id; a Transaction with its Recurring pin, a Wallet or
 * definition still frozen. */
async function replay(token: string, entry: UndoEntry): Promise<DeletedEntity> {
  switch (entry.kind) {
    case 'transaction':
      return { kind: 'transaction', entity: await undoTransaction(token, entry.entity) }
    case 'wallet':
      return { kind: 'wallet', entity: await undoWalletDelete(token, entry.entity) }
    case 'recurring-cost':
      return {
        kind: 'recurring-cost',
        entity: await undoRecurringCostDelete(token, entry.entity),
      }
    case 'recurring-income':
      return {
        kind: 'recurring-income',
        entity: await undoRecurringIncomeDelete(token, entry.entity),
      }
  }
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const { formatMessage } = useIntl()
  // The stack (ADR-0031): in-memory, newest first, max three across kinds.
  const [stack, setStack] = useState<UndoEntry[]>([])
  const [restored, setRestored] = useState<RestoredEntity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  const pushDeleted = useCallback((deleted: DeletedEntity) => {
    setStack((current) => pushEntry(current, deleted, Date.now()).stack)
  }, [])

  const clear = useCallback(() => {
    setStack(clearStack())
  }, [])

  // Undo (ADR-0031): call the kind's undo endpoint; the toast goes either
  // way — on success the restored entity reaches its screen, on failure
  // (the name taken, the pin paid, a network error) the message shows
  // above the toasts.
  const handleUndo = async (entry: UndoEntry) => {
    const token = localStorage.getItem(TOKEN_KEY) ?? ''
    const key = entryKey(entry)
    try {
      const back = await replay(token, entry)
      setStack((current) => removeEntry(current, key))
      setError(null)
      seq.current += 1
      setRestored({ ...back, seq: seq.current })
    } catch (failure) {
      setStack((current) => removeEntry(current, key))
      setError(
        failure instanceof ApiError
          ? failure.message
          : formatMessage({ id: 'undoToast.error' }),
      )
    }
  }

  // Dismiss an entry (expiry or manual ✕).
  const handleDismiss = useCallback((key: string) => {
    setStack((current) => removeEntry(current, key))
  }, [])

  // Periodically expire entries that have outlived their window.
  useEffect(() => {
    const timer = setInterval(() => {
      setStack((current) => expireEntries(current, Date.now()).stack)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const value = useMemo(
    () => ({ pushDeleted, restored, clear }),
    [pushDeleted, restored, clear],
  )

  return (
    <UndoContext.Provider value={value}>
      {children}
      <UndoToastStack
        stack={stack}
        onUndo={handleUndo}
        onDismiss={handleDismiss}
        error={error}
        onDismissError={() => setError(null)}
      />
    </UndoContext.Provider>
  )
}
