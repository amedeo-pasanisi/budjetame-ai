import { useIntl } from 'react-intl'
import { type Category, type CategoryType } from './api'
import { ModalShell } from './ModalShell'
import { CategoryForm } from './CategoryForm'

type CategoryModalProps = {
  category?: Category
  lockedType?: CategoryType
  prefillName?: string
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  onMerged?: (deletedId: number, surviving: Category) => void
  onClose: () => void
}

/** The create/edit/delete Category form inside the shared modal shell
 * (issue #41). Create and edit share this one modal: the Type selector
 * only appears while creating, and the tap-again delete confirmation only
 * while editing. The shell adds the dismissal paths — backdrop click, Cancel,
 * and Escape all abandon the draft without saving. */
export function CategoryModal({
  category,
  lockedType,
  prefillName,
  onSaved,
  onDeleted,
  onMerged,
  onClose,
}: CategoryModalProps) {
  const { formatMessage } = useIntl()
  const editing = category !== undefined
  return (
    <ModalShell
      label={formatMessage({ id: editing ? 'categoryModal.label.edit' : 'categoryModal.label.new' })}
      onClose={onClose}
    >
      <CategoryForm
        key={editing ? category.id : 'create'}
        category={category}
        lockedType={lockedType}
        prefillName={prefillName}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onMerged={onMerged}
        onCancel={onClose}
      />
    </ModalShell>
  )
}