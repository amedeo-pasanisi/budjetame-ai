import { useEffect, useState, type FormEvent } from 'react'

import {
  ApiError,
  TOKEN_KEY,
  apiErrorMessage,
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
  type Category,
  type CategoryType,
} from './api'

const TYPE_LABELS: Record<CategoryType, string> = {
  expense: 'Expense',
  income: 'Income',
}

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

export function CategoriesScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCategories(token)
      .then((data) => {
        if (!cancelled) setCategories(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your categories.')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const handleCreated = (category: Category) => {
    setCategories((current) =>
      current === null ? [category] : [...current, category],
    )
    setShowCreate(false)
  }

  const handleUpdated = (category: Category) => {
    setCategories((current) =>
      current === null
        ? [category]
        : current.map((existing) =>
            existing.id === category.id ? category : existing,
          ),
    )
    setEditing(null)
  }

  const handleDeleted = (categoryId: number) => {
    setCategories((current) =>
      current === null ? current : current.filter((c) => c.id !== categoryId),
    )
    setEditing(null)
  }

  return (
    <>
      <h2 className="font-semibold text-slate-900">Categories</h2>

      {loadError !== null && (
        <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>
      )}

      {categories === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading categories…</p>
      ) : categories.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No categories yet. Add one to start grouping your transactions.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {categories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                onClick={() => setEditing(category)}
                className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-base"
                  style={{ backgroundColor: category.color }}
                >
                  {category.icon ?? ''}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">
                    {category.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {TYPE_LABELS[category.type]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!showCreate && editing === null && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="mt-5 w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
        >
          + New category
        </button>
      )}

      {showCreate && (
        <CategoryForm
          key="new-category"
          onSaved={handleCreated}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {editing !== null && (
        <CategoryForm
          key={editing.id}
          category={editing}
          onSaved={handleUpdated}
          onDeleted={handleDeleted}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  )
}

type CategoryFormProps = {
  category?: Category
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  onCancel: () => void
}

function CategoryForm({ category, onSaved, onDeleted, onCancel }: CategoryFormProps) {
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
          ? apiErrorMessage(err, 'A category with this name already exists.', editing ? 'Could not save the category.' : 'Could not create the category.')
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
      className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
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
