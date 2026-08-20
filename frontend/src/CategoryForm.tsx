import { useState, type FormEvent } from 'react'

import {
  ApiError,
  CategoryMergeConflict,
  TOKEN_KEY,
  apiErrorMessage,
  createCategory,
  deleteCategory,
  mergeCategories,
  updateCategory,
  type Category,
  type CategoryType,
} from './api'

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
]

const TYPE_LABELS: Record<CategoryType, string> = {
  expense: 'Expense',
  income: 'Income',
}

type CategoryFormProps = {
  category?: Category
  /** Eligibility locking (ADR-0013): when set, the Type selector is hidden
   * and the type preset — create mode only, for inline creation from a
   * form whose field only accepts one type (e.g. an Expense form can only
   * create expense Categories). */
  lockedType?: CategoryType
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  /** The confirmed merge (ADR-0007): the renamed Category is gone and the
   * surviving one returned, so the list can show exactly the survivor. */
  onMerged?: (deletedId: number, surviving: Category) => void
  onCancel: () => void
}

/** The create/edit/delete form for a Category, hosted in the modal
 * shell (CategoryModal). The form itself is unchanged from the inline days:
 * Name and color/icon, plus a Type selector only while creating (the Type is
 * fixed when editing), and the tap-again delete confirmation. A rename that
 * collides with an existing same-Type name stops being an error (issue #45):
 * the form shows the merge offer — "Merge X into Y? N transactions will
 * move" — with the tap-again-to-confirm pattern, and confirming runs the
 * merge. Cancel — like the shell's backdrop and Escape — abandons the draft
 * without saving. */
export function CategoryForm({
  category,
  lockedType,
  onSaved,
  onDeleted,
  onMerged,
  onCancel,
}: CategoryFormProps) {
  const editing = category !== undefined
  const [name, setName] = useState(category?.name ?? '')
  const [type, setType] = useState<CategoryType>(category?.type ?? lockedType ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? '')
  const [color, setColor] = useState(category?.color ?? PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // The merge offer (ADR-0007): set when a rename save collided with an
  // existing same-Type Category. `name` is the collision — the surviving
  // Category's name; `category.name` is the one that would be absorbed.
  const [mergeOffer, setMergeOffer] = useState<{
    targetId: number
    transactionCount: number
  } | null>(null)
  const [confirmingMerge, setConfirmingMerge] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const saved = editing
        ? await updateCategory(token, category.id, { name, icon, color })
        : await createCategory(token, { name, type, icon, color })
      onSaved(saved)
    } catch (err) {
      if (editing && err instanceof CategoryMergeConflict) {
        // The collision is a merge offer, not an error: show the
        // confirmation instead of the failure message (issue #45).
        setMergeOffer({
          targetId: err.targetId,
          transactionCount: err.transactionCount,
        })
      } else {
        setError(
          err instanceof ApiError
            ? apiErrorMessage(
                err,
                'A category with this name already exists.',
                editing ? 'Could not save the category.' : 'Could not create the category.',
              )
            : 'Something went wrong.',
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  /** The confirmed merge: first tap arms it, the second executes (the same
   * tap-again-to-confirm pattern as delete). */
  const handleMerge = async () => {
    if (category === undefined || mergeOffer === null) {
      return
    }
    if (!confirmingMerge) {
      setConfirmingMerge(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const surviving = await mergeCategories(token, category.id, mergeOffer.targetId)
      onMerged?.(category.id, surviving)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              'A category with this name already exists.',
              'Could not merge the categories.',
            )
          : 'Something went wrong.',
      )
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (category === undefined) {
      return
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      await deleteCategory(token, category.id)
      onDeleted?.(category.id)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? apiErrorMessage(err, 'A category with this name already exists.', 'Could not delete the category.')
          : 'Something went wrong.',
      )
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {editing ? 'Edit category' : 'New category'}
      </h2>
      {editing && (
        <p className="text-xs text-slate-500">
          {TYPE_LABELS[category.type]} · type cannot be changed
        </p>
      )}

      <div>
        <label htmlFor="category-name" className="block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="category-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            // A new name invalidates the offer: it was about the collision
            // the user just typed.
            setMergeOffer(null)
            setConfirmingMerge(false)
          }}
          placeholder="e.g. Groceries"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {!editing && lockedType !== undefined && (
        <p className="text-xs text-slate-500">
          {TYPE_LABELS[lockedType]} · fixed for this form
        </p>
      )}

      {!editing && lockedType === undefined && (
        <div>
          <label htmlFor="category-type" className="block text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="category-type"
            value={type}
            onChange={(event) => setType(event.target.value as CategoryType)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
      )}

      <div>
        <span className="block text-sm font-medium text-slate-700">Color</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setColor(preset)}
              aria-label={`Use color ${preset}`}
              className={`h-8 w-8 rounded-full ${
                color === preset ? 'ring-2 ring-slate-900 ring-offset-2' : ''
              }`}
              style={{ backgroundColor: preset }}
            />
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="category-icon" className="block text-sm font-medium text-slate-700">
          Icon (optional)
        </label>
        <input
          id="category-icon"
          type="text"
          maxLength={16}
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          placeholder="e.g. 🛒"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      {mergeOffer !== null && category !== undefined && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-slate-800">
            Merge {category.name} into {name}? {mergeOffer.transactionCount} transactions
            will move — this cannot be undone.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={handleMerge}
              disabled={submitting}
              className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium ${
                confirmingMerge
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-amber-300 bg-white text-amber-800'
              }`}
            >
              {submitting ? 'Merging…' : confirmingMerge ? 'Tap again to confirm' : 'Merge'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMergeOffer(null)
                setConfirmingMerge(false)
              }}
              disabled={submitting}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600"
            >
              Cancel merge
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || name.trim() === ''}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Saving…' : editing ? 'Save' : 'Create category'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
        >
          Cancel
        </button>
      </div>

      {editing && onDeleted !== undefined && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={submitting}
          className={`w-full rounded-lg border px-4 py-2 text-sm font-medium ${
            confirmingDelete
              ? 'border-red-600 bg-red-600 text-white'
              : 'border-red-200 text-red-600'
          }`}
        >
          {submitting ? 'Deleting…' : confirmingDelete ? 'Tap again to confirm' : 'Delete category'}
        </button>
      )}
    </form>
  )
}
