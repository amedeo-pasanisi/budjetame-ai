import {
  type Category,
  type RecurringCost,
  type RecurringIncome,
  type Transaction,
  type Wallet,
} from './api'
import { ModalShell } from './ModalShell'
import { TransactionForm } from './TransactionForm'
import type { WalletTarget } from './transactionFields'

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
  /** Inline entity creation (ADR-0013): opens the Wallet create modal
   * hosted by the screen, for the field whose sentinel was picked. */
  onAddWallet: (target: WalletTarget) => void
  /** The freshly created Wallet the screen reports back, with the field
   * whose sentinel was picked. */
  walletToSelect: { id: number; target: WalletTarget } | null
  /** Inline entity creation (ADR-0013): opens the Recurring Cost create
   * modal hosted by the screen, stacked on top of this one. */
  onAddRecurringCost: () => void
  /** The freshly created Recurring Cost's id, reported back so the form's
   * Recurring Cost field selects it. */
  recurringCostToSelect: number | null
  /** Inline entity creation (ADR-0013): opens the Recurring Income create
   * modal hosted by the screen, stacked on top of this one. */
  onAddRecurringIncome: () => void
  /** The freshly created Recurring Income's id, reported back so the
   * form's Recurring Income field selects it. */
  recurringIncomeToSelect: number | null
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
  onAddWallet,
  walletToSelect,
  onAddRecurringCost,
  recurringCostToSelect,
  onAddRecurringIncome,
  recurringIncomeToSelect,
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
        onAddWallet={onAddWallet}
        walletToSelect={walletToSelect}
        onAddRecurringCost={onAddRecurringCost}
        recurringCostToSelect={recurringCostToSelect}
        onAddRecurringIncome={onAddRecurringIncome}
        recurringIncomeToSelect={recurringIncomeToSelect}
      />
    </ModalShell>
  )
}
