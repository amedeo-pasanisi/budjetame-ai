import {
  type Category,
  type RecurringCost,
  type RecurringIncome,
  type Transaction,
  type Wallet,
} from './api'
import { ModalShell } from './ModalShell'
import { TransactionForm } from './TransactionForm'

type TransactionModalProps = {
  wallets: Wallet[]
  categories: Category[]
  recurringCosts: RecurringCost[]
  recurringIncomes: RecurringIncome[]
  editing: Transaction | null
  onSaved: (transaction: Transaction) => void
  onDeleted: (warning: boolean) => void
  onClose: () => void
  /** Inline entity creation (ADR-0013): opens the Category create modal
   * hosted by the screen, locked to the transaction's current type. */
  onAddCategory: (type: 'expense' | 'income') => void
  /** The freshly created Category the screen reports back: the field selects
   * it, leaving the rest of the draft untouched. */
  categoryToSelect: number | null
}

/** The create/edit/delete Transaction form inside the shared modal shell
 * (US8–US10, issue #41). The form itself is unchanged from the inline
 * days; the shell adds the dismissal paths — backdrop click, Cancel, and
 * Escape all abandon the draft without saving. */
export function TransactionModal({
  wallets,
  categories,
  recurringCosts,
  recurringIncomes,
  editing,
  onSaved,
  onDeleted,
  onClose,
  onAddCategory,
  categoryToSelect,
}: TransactionModalProps) {
  return (
    <ModalShell
      label={editing === null ? 'New transaction' : 'Edit transaction'}
      onClose={onClose}
    >
      <TransactionForm
        key={editing?.id ?? 'create'}
        wallets={wallets}
        categories={categories}
        recurringCosts={recurringCosts}
        recurringIncomes={recurringIncomes}
        editing={editing}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onCancel={onClose}
        onAddCategory={onAddCategory}
        categoryToSelect={categoryToSelect}
      />
    </ModalShell>
  )
}
