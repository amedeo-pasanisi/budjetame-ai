import { useEffect } from 'react'

import { type Category, type Transaction, type Wallet } from './api'
import { TransactionForm } from './TransactionForm'

type TransactionModalProps = {
  wallets: Wallet[]
  categories: Category[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: (warning: boolean) => void
  onClose: () => void
}

/** The create/edit/delete Transaction form inside a modal shell (US8–US10).
 * The form itself is unchanged from the inline days; the shell adds the
 * dismissal paths — backdrop click, Cancel, and Escape all abandon the draft
 * without saving. On a phone it sits as a bottom sheet that scrolls
 * internally; on larger screens it centers. */
export function TransactionModal({
  wallets,
  categories,
  editing,
  onSaved,
  onDeleted,
  onClose,
}: TransactionModalProps) {
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
      {/* Backdrop is a sibling of the panel so clicks inside the panel never
       * reach it. */}
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing === null ? 'New transaction' : 'Edit transaction'}
        className="relative flex max-h-[92svh] w-full max-w-sm flex-col overflow-hidden rounded-t-2xl bg-slate-50 shadow-xl sm:rounded-2xl"
      >
        <div className="overflow-y-auto p-4">
          <TransactionForm
            key={editing?.id ?? 'create'}
            wallets={wallets}
            categories={categories}
            editing={editing}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  )
}
