import { useEffect, type ReactNode } from 'react'

type ModalShellProps = {
  /** The accessible name of the dialog (e.g. "Edit category"). */
  label: string
  onClose: () => void
  children: ReactNode
}

/** The shared modal shell (issue #41; ADR-0008), used by every modal. The
 * dialog centers vertically on every screen size, fully inside the viewport
 * with rounded corners on all sides and a small side margin on phones; tall
 * content scrolls inside the modal. The three dismissal paths — backdrop
 * tap, Escape, and Cancel (via the form's onCancel) — all abandon the draft
 * without saving. The page behind is scroll-locked while open. */
export function ModalShell({ label, onClose, children }: ModalShellProps) {
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      // The open modal owns its touches (issue #51): a swipe that starts
      // anywhere inside the overlay — panel or backdrop — must never reach
      // the page behind and switch tabs.
      onTouchStart={(event) => event.stopPropagation()}
    >
      {/* The backdrop is a sibling of the panel so clicks inside the panel
       * never reach it. */}
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative mx-4 flex max-h-[92svh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-xl"
      >
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
