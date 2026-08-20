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
  /** Inline entity creation (ADR-0013): opens the Category create modal
   * hosted by the screen, stacked on top of this one. */
  onAddCategory: () => void
  /** The freshly created Category's id, reported back so the form's field
   * selects it. */
  categoryToSelect: number | null
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
  onAddCategory,
  categoryToSelect,
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
        onAddCategory={onAddCategory}
        categoryToSelect={categoryToSelect}
      />
    </ModalShell>
  )
}
