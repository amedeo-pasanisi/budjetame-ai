import type { Category, RecurringCost, Wallet } from './api'
import { ModalShell } from './ModalShell'
import { RecurringCostForm } from './RecurringCostForm'

type RecurringCostModalProps = {
  cost?: RecurringCost
  wallets: Wallet[]
  categories: Category[]
  onSaved: (cost: RecurringCost) => void
  onDeleted?: (costId: number) => void
  onClose: () => void
}

/** The create/edit Recurring Cost form inside the shared modal shell
 * (issue #56). Create and edit share this one modal, like Wallets and
 * Categories; the shell adds the dismissal paths — backdrop tap, Escape, and
 * Cancel all abandon the draft without saving. */
export function RecurringCostModal({
  cost,
  wallets,
  categories,
  onSaved,
  onDeleted,
  onClose,
}: RecurringCostModalProps) {
  const editing = cost !== undefined
  return (
    <ModalShell label={editing ? 'Edit recurring cost' : 'New recurring cost'} onClose={onClose}>
      <RecurringCostForm
        key={editing ? cost.id : 'create'}
        cost={cost}
        wallets={wallets}
        categories={categories}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onCancel={onClose}
      />
    </ModalShell>
  )
}
