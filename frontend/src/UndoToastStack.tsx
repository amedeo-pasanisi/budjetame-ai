/** The undo toast stack (ADR-0031): up to three toasts at the bottom of the
 * screen, each with its own 10-second countdown. Tapping Undo re-creates
 * the Transaction via client replay. Expiry or dismissal removes a toast.
 *
 * The component takes the current stack of entries, a callback for Undo,
 * and a callback for dismiss. It manages countdown timers internally:
 * each entry gets a decreasing counter that reaches 0 at UNDO_WINDOW_MS
 * after its createdAt. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { UNDO_WINDOW_MS, type UndoEntry } from './undoStack'

export type { UndoEntry } from './undoStack'

type UndoToastStackProps = {
  /** The current undo stack, newest first. */
  stack: UndoEntry[]
  /** Called on Undo tap with the entry to restore. */
  onUndo: (entry: UndoEntry) => void
  /** Called on dismiss or expiry with the entry's transaction id. */
  onDismiss: (transactionId: number) => void
}

/** How often the countdown ticks (ms). Per the 10-second window, every
 * second is enough — 1-second granularity matches the UX. */
const TICK_MS = 1000

export function UndoToastStack({ stack, onUndo, onDismiss }: UndoToastStackProps) {
  // Track countdowns: remaining seconds for each entry id.
  // Re-computed every TICK_MS from the entries' createdAt.
  const [countdowns, setCountdowns] = useState<Record<number, number>>({})

  // Track which entries we've already called onDismiss for, to avoid
  // calling it multiple times for the same expired entry.
  const dismissedRef = useRef<Set<number>>(new Set())

  // Refresh countdowns every TICK_MS and expire entries.
  const tick = useCallback(() => {
    const now = Date.now()
    const next: Record<number, number> = {}
    for (const entry of stack) {
      const elapsed = now - entry.createdAt
      const remaining = Math.max(0, Math.ceil((UNDO_WINDOW_MS - elapsed) / 1000))
      next[entry.transaction.id] = remaining
      if (remaining <= 0 && !dismissedRef.current.has(entry.transaction.id)) {
        dismissedRef.current.add(entry.transaction.id)
        onDismiss(entry.transaction.id)
      }
    }
    setCountdowns(next)
  }, [stack, onDismiss])

  useEffect(() => {
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [tick])

  // Reset dismissed set when stack changes (a new mount clears it).
  useEffect(() => {
    dismissedRef.current = new Set()
  }, [stack.length === 0 ? 'empty' : 'non-empty'])

  if (stack.length === 0) return null

  return (
    <div
      aria-label="Undo opportunities"
      className="fixed bottom-0 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col-reverse gap-2 p-4"
    >
      {stack.map((entry) => {
        const remaining = countdowns[entry.transaction.id] ?? 10
        return (
          <div
            key={entry.transaction.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg"
            role="status"
          >
            <span className="min-w-0 text-sm text-slate-700">
              <span className="font-medium">Transaction deleted</span>
              {entry.transaction.description !== null && entry.transaction.description.trim() !== '' && (
                <span> · {entry.transaction.description}</span>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs tabular-nums text-slate-400">
                {remaining}s
              </span>
              <button
                type="button"
                onClick={() => onUndo(entry)}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 active:bg-indigo-800"
              >
                Undo
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => onDismiss(entry.transaction.id)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}