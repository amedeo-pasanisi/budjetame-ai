/** The app-wide Undo seam (ADR-0031, lifted to the app shell by
 * ADR-0034): what a screen needs to report a delete and to take back what
 * an Undo restored, and what the shell needs to forfeit every pending undo
 * after a Restore. The provider that fills it lives in UndoProvider.tsx.
 * Rendered without a provider — a screen test — the hook is a no-op, so a
 * bare screen behaves as before. */

import { createContext, useContext } from 'react'

import type { DeletedEntity } from './undoStack'

/** What an Undo brought back, as the owning screen receives it. `seq`
 * makes every restore a new value, so two undos of the same entity in a
 * row both reach the screen. */
export type RestoredEntity = DeletedEntity & { seq: number }

export type UndoContextValue = {
  /** Report a delete: the entity enters the stack and its toast appears. */
  pushDeleted: (deleted: DeletedEntity) => void
  /** The entity the last successful Undo restored, or null. The screen
   * that owns its kind puts it back in its list. */
  restored: RestoredEntity | null
  /** Forfeit every pending undo (a Restore replaced the whole state). */
  clear: () => void
}

export const UndoContext = createContext<UndoContextValue>({
  pushDeleted: () => {},
  restored: null,
  clear: () => {},
})

export function useUndo(): UndoContextValue {
  return useContext(UndoContext)
}
