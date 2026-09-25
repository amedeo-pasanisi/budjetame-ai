import { useIntl } from 'react-intl'
import type { RecurringCost } from './api'
import { ModalShell } from './ModalShell'
import { RecurringCostForm } from './RecurringCostForm'

type RecurringCostModalProps = {
  cost?: RecurringCost
  onSaved: (cost: RecurringCost) => void
  onFreeze?: (cost: RecurringCost) => void
  onUnfreeze?: (cost: RecurringCost) => void
  onClose: () => void
}

/** The create/edit Recurring Cost form inside the shared modal shell
 * (issue #56). Create and edit share this one modal, like Wallets and
 * Categories; the shell adds the dismissal paths — backdrop tap, Escape, and
 * Cancel all abandon the draft without saving. Freeze/Unfreeze (ADR-0028)
 * replaces the old delete action. */
export function RecurringCostModal({
  cost,
  onSaved,
  onFreeze,
  onUnfreeze,
  onClose,
}: RecurringCostModalProps) {
  const { formatMessage } = useIntl()
  const editing = cost !== undefined
  return (
    <ModalShell
      label={formatMessage({ id: editing ? 'recurringCostModal.label.edit' : 'recurringCostModal.label.new' })}
      onClose={onClose}
    >
      <RecurringCostForm
        key={editing ? cost.id : 'create'}
        cost={cost}
        onSaved={onSaved}
        onFreeze={onFreeze}
        onUnfreeze={onUnfreeze}
        onCancel={onClose}
      />
    </ModalShell>
  )
}