import { type Category, type CategoryType } from './api'
import { ModalShell } from './ModalShell'
import { CategoryForm } from './CategoryForm'

type CategoryModalProps = {
  category?: Category
  /** Eligibility locking (ADR-0013): hides the Type selector and presets
   * the type — create mode only, for inline creation from a form whose
   * field only accepts one type. */
  lockedType?: CategoryType
  /** The create form's prefilled Name (issue #77): the row editor opens
   * this modal with the missing name from the file, so the user does not
   * retype it. Create mode only — an edited Category keeps its own name. */
  prefillName?: string
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  /** The confirmed merge (ADR-0007): the renamed Category is gone and the
   * surviving one returned. */
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
  const editing = category !== undefined
  return (
    <ModalShell label={editing ? 'Edit category' : 'New category'} onClose={onClose}>
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
