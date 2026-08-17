import { useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createCategory,
  deleteCategory,
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
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  onCancel: () => void
}

/** The create/edit/delete form for a Category, hosted in the bottom-sheet
 * shell (CategoryModal). The form itself is unchanged from the inline days:
 * Name and color/icon, plus a Type selector only while creating (the Type is
 * fixed when editing), and the tap-again delete confirmation. Cancel — like
 * the shell's backdrop and Escape — abandons the draft without saving. */
export function CategoryForm({ category, onSaved, onDeleted, onCancel }: CategoryFormProps) {
  const editing = category !== undefined
  const [name, setName] = useState(category?.name ?? '')
  const [type, setType] = useState<CategoryType>(category?.type ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? '')
  const [color, setColor] = useState(category?.color ?? PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

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
      setError(
        err instanceof ApiError
          ? apiErrorMessage(
              err,
              'A category with this name already exists.',
              editing ? 'Could not save the category.' : 'Could not create the category.',
            )
          : 'Something went wrong.',
      )
    } finally {
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
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Groceries"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {!editing && (
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
