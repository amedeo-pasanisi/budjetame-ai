import { type Category } from './api'
import { BottomSheet } from './BottomSheet'
import { CategoryForm } from './CategoryForm'

type CategoryModalProps = {
  category?: Category
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  onClose: () => void
}

/** The create/edit/delete Category form inside the shared bottom-sheet
 * shell (issue #41). Create and edit share this one modal: the Type selector
 * only appears while creating, and the tap-again delete confirmation only
 * while editing. The shell adds the dismissal paths — backdrop click, Cancel,
 * and Escape all abandon the draft without saving. */
export function CategoryModal({ category, onSaved, onDeleted, onClose }: CategoryModalProps) {
  const editing = category !== undefined
  return (
    <BottomSheet label={editing ? 'Edit category' : 'New category'} onClose={onClose}>
      <CategoryForm
        key={editing ? category.id : 'create'}
        category={category}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onCancel={onClose}
      />
    </BottomSheet>
  )
}
