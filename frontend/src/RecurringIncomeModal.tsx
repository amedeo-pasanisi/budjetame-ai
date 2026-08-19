import type { Category, RecurringIncome, Wallet } from './api'
import { ModalShell } from './ModalShell'
import { RecurringIncomeForm } from './RecurringIncomeForm'

type RecurringIncomeModalProps = {
  income?: RecurringIncome
  wallets: Wallet[]
  categories: Category[]
  onSaved: (income: RecurringIncome) => void
  onDeleted?: (incomeId: number) => void
  onClose: () => void
}

/** The create/edit Recurring Income form inside the shared modal shell
 * (issue #60), mirroring the Costs side (issue #56, ADR-0011). Create and
 * edit share this one modal, like Wallets and Categories; the shell adds the
 * dismissal paths — backdrop tap, Escape, and Cancel all abandon the draft
 * without saving. */
export function RecurringIncomeModal({
  income,
  wallets,
  categories,
  onSaved,
  onDeleted,
  onClose,
}: RecurringIncomeModalProps) {
  const editing = income !== undefined
  return (
    <ModalShell
      label={editing ? 'Edit recurring income' : 'New recurring income'}
      onClose={onClose}
    >
      <RecurringIncomeForm
        key={editing ? income.id : 'create'}
        income={income}
        wallets={wallets}
        categories={categories}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onCancel={onClose}
      />
    </ModalShell>
  )
}
