import { type Category, type Transaction, type Wallet } from './api'
import { BottomSheet } from './BottomSheet'
import { TransactionForm } from './TransactionForm'

type TransactionModalProps = {
  wallets: Wallet[]
  categories: Category[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: (warning: boolean) => void
  onClose: () => void
}

/** The create/edit/delete Transaction form inside the shared bottom-sheet
 * shell (US8–US10, issue #41). The form itself is unchanged from the inline
 * days; the shell adds the dismissal paths — backdrop click, Cancel, and
 * Escape all abandon the draft without saving. */
export function TransactionModal({
  wallets,
  categories,
  editing,
  onSaved,
  onDeleted,
  onClose,
}: TransactionModalProps) {
  return (
    <BottomSheet
      label={editing === null ? 'New transaction' : 'Edit transaction'}
      onClose={onClose}
    >
      <TransactionForm
        key={editing?.id ?? 'create'}
        wallets={wallets}
        categories={categories}
        editing={editing}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onCancel={onClose}
      />
    </BottomSheet>
  )
}
