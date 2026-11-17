import { useIntl } from 'react-intl'
import type { RecurringDefinition } from './api'
import { ModalShell } from './ModalShell'
import { RecurringDefinitionForm } from './RecurringDefinitionForm'
import { SIDES, type RecurringSide } from './recurringSide'

type RecurringDefinitionModalProps = {
  side: RecurringSide
  definition?: RecurringDefinition
  onSaved: (definition: RecurringDefinition) => void
  onFreeze?: (definition: RecurringDefinition) => void
  onUnfreeze?: (definition: RecurringDefinition) => void
  /** A frozen definition was deleted for good (ADR-0034). */
  onDeleted?: (definition: RecurringDefinition) => void
  onClose: () => void
}

/** The create/edit form of one Recurring side inside the shared modal shell
 * (issues #56, #60; ADR-0033: one modal, the side as a value). Create and
 * edit share this one modal, like Wallets and Categories; the shell adds
 * the dismissal paths — backdrop tap, Escape, and Cancel all abandon the
 * draft without saving. Freeze/Unfreeze (ADR-0028) replaces the old delete
 * action; a frozen definition with no history can be deleted for good
 * from its read-only form (ADR-0034). */
export function RecurringDefinitionModal({
  side,
  definition,
  onSaved,
  onFreeze,
  onUnfreeze,
  onDeleted,
  onClose,
}: RecurringDefinitionModalProps) {
  const { formatMessage } = useIntl()
  const editing = definition !== undefined
  const labelId = `${SIDES[side].messages.modal}.label.${editing ? 'edit' : 'new'}`
  return (
    <ModalShell label={formatMessage({ id: labelId })} onClose={onClose}>
      <RecurringDefinitionForm
        key={editing ? definition.id : 'create'}
        side={side}
        definition={definition}
        onSaved={onSaved}
        onFreeze={onFreeze}
        onUnfreeze={onUnfreeze}
        onDeleted={onDeleted}
        onCancel={onClose}
      />
    </ModalShell>
  )
}
