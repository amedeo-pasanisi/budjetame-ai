import { useIntl } from 'react-intl'
import type { RecurringIncome } from './api'
import { ModalShell } from './ModalShell'
import { RecurringIncomeForm } from './RecurringIncomeForm'

type RecurringIncomeModalProps = {
  income?: RecurringIncome
  onSaved: (income: RecurringIncome) => void
  onFreeze?: (income: RecurringIncome) => void
  onUnfreeze?: (income: RecurringIncome) => void
  onClose: () => void
}

/** The create/edit Recurring Income form inside the shared modal shell
 * (issue #60), mirroring the Costs side (issue #56, ADR-0011). Create and
 * edit share this one modal, like Wallets and Categories; the shell adds the
 * dismissal paths — backdrop tap, Escape, and Cancel all abandon the draft
 * without saving. Freeze/Unfreeze (ADR-0028) replaces the old delete
 * action. */
export function RecurringIncomeModal({
  income,
  onSaved,
  onFreeze,
  onUnfreeze,
  onClose,
}: RecurringIncomeModalProps) {
  const { formatMessage } = useIntl()
  const editing = income !== undefined
  return (
    <ModalShell
      label={formatMessage({ id: editing ? 'recurringIncomeModal.label.edit' : 'recurringIncomeModal.label.new' })}
      onClose={onClose}
    >
      <RecurringIncomeForm
        key={editing ? income.id : 'create'}
        income={income}
        onSaved={onSaved}
        onFreeze={onFreeze}
        onUnfreeze={onUnfreeze}
        onCancel={onClose}
      />
    </ModalShell>
  )
}