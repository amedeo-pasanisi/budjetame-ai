import { useEffect, type ReactNode } from 'react'

type BottomSheetProps = {
  /** The accessible name of the sheet (e.g. "Edit category"). */
  label: string
  onClose: () => void
  children: ReactNode
}

/** The shared bottom-sheet modal shell (issue #41), extracted from the
 * Transaction modal. The three dismissal paths — backdrop tap, Escape, and
 * Cancel (via the form's onCancel) — all abandon the draft without saving.
 * On a phone the sheet slides up from the bottom and scrolls internally; on
 * larger screens it centers. The page behind is scroll-locked while open. */
export function BottomSheet({ label, onClose, children }: BottomSheetProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    // Lock the page behind the modal so the list cannot scroll out from
    // under the draft.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* The backdrop is a sibling of the panel so clicks inside the panel
       * never reach it. */}
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative flex max-h-[92svh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-slate-50 shadow-xl sm:rounded-2xl"
      >
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
