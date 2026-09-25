import { useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'

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
import { FieldError } from './FieldError'
import { fieldErrorProps, type FieldErrors } from './validation'

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

const TYPE_OPTIONS: { value: CategoryType; labelId: string }[] = [
  { value: 'expense', labelId: 'categories.type.expense' },
  { value: 'income', labelId: 'categories.type.income' },
]

type CategoryFormProps = {
  category?: Category
  lockedType?: CategoryType
  prefillName?: string
  onSaved: (category: Category) => void
  onDeleted?: (categoryId: number) => void
  onMerged?: (deletedId: number, surviving: Category) => void
  onCancel: () => void
}

/** Submit-and-validate (ADR-0029): the Category form's pure validation,
 * returning i18n message IDs keyed by field — the form translates them
 * through `formatMessage` before passing to FieldError. The Category form
 * has no Amount field, so the tolerant Amount Input contract does not apply
 * here: Name is the only client-side rule. */
function validate(name: string): FieldErrors {
  if (name.trim() === '') return { name: 'categoryForm.validation.nameEmpty' }
  return {}
}

/** Translate FieldErrors from i18n message IDs to human-readable strings. */
function translateErrors(errors: FieldErrors, formatMessage: (descriptor: { id: string }) => string): FieldErrors {
  const translated: FieldErrors = {}
  for (const [field, key] of Object.entries(errors)) {
    translated[field] = formatMessage({ id: key })
  }
  return translated
}

/** The create/edit/delete form for a Category, hosted in the modal
 * shell (CategoryModal). */
export function CategoryForm({
  category,
  lockedType,
  prefillName,
  onSaved,
  onDeleted,
  onMerged,
  onCancel,
}: CategoryFormProps) {
  const { formatMessage } = useIntl()
  const editing = category !== undefined
  const [name, setName] = useState(category?.name ?? prefillName ?? '')
  const [type, setType] = useState<CategoryType>(category?.type ?? lockedType ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? '')
  const [color, setColor] = useState(category?.color ?? PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [mergeOffer, setMergeOffer] = useState<{
    targetId: number
    transactionCount: number
  } | null>(null)
  const [confirmingMerge, setConfirmingMerge] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fieldErrors = validate(name)
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(translateErrors(fieldErrors, formatMessage))
      return
    }
    setErrors({})
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
        setMergeOffer({
          targetId: err.targetId,
          transactionCount: err.transactionCount,
        })
      } else {
        setError(
          err instanceof ApiError
            ? apiErrorMessage(
                err,
                formatMessage({ id: 'categoryForm.error.conflict' }),
                editing ? formatMessage({ id: 'categoryForm.error.save' }) : formatMessage({ id: 'categoryForm.error.create' }),
              )
            : formatMessage({ id: 'categoryForm.error.generic' }),
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

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
              formatMessage({ id: 'categoryForm.error.conflict' }),
              formatMessage({ id: 'categoryForm.error.merge' }),
            )
          : formatMessage({ id: 'categoryForm.error.generic' }),
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
          ? apiErrorMessage(err, formatMessage({ id: 'categoryForm.error.conflict' }), formatMessage({ id: 'categoryForm.error.delete' }))
          : formatMessage({ id: 'categoryForm.error.generic' }),
      )
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-medium text-slate-900">
        {formatMessage({ id: editing ? 'categoryForm.title.edit' : 'categoryForm.title.new' })}
      </h2>
      {editing && (
        <p className="text-xs text-slate-500">
          {formatMessage({ id: 'categories.typeLocked' }, { type: formatMessage({ id: category.type === 'expense' ? 'categories.type.expense' : 'categories.type.income' }) })}
        </p>
      )}

      <div>
        <label htmlFor="category-name" className="block text-sm font-medium text-slate-700">
          {formatMessage({ id: 'categoryForm.name' })}
        </label>
        <input
          id="category-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setMergeOffer(null)
            setConfirmingMerge(false)
          }}
          placeholder={formatMessage({ id: 'categoryForm.namePlaceholder' })}
          {...fieldErrorProps('name', errors)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
        <FieldError field="name" errors={errors} />
      </div>

      {!editing && lockedType !== undefined && (
        <p className="text-xs text-slate-500">
          {formatMessage({ id: 'categoryForm.typeFixed' }, { type: formatMessage({ id: lockedType === 'expense' ? 'categories.type.expense' : 'categories.type.income' }) })}
        </p>
      )}

      {!editing && lockedType === undefined && (
        <div>
          <label htmlFor="category-type" className="block text-sm font-medium text-slate-700">
            {formatMessage({ id: 'categoryForm.type' })}
          </label>
          <select
            id="category-type"
            value={type}
            onChange={(event) => setType(event.target.value as CategoryType)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {formatMessage({ id: option.labelId })}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <span className="block text-sm font-medium text-slate-700">{formatMessage({ id: 'categoryForm.color' })}</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESET_COLORS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setColor(preset)}
              aria-label={formatMessage({ id: 'categoryForm.colorAria' }, { preset })}
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
          {formatMessage({ id: 'categoryForm.icon' })}
        </label>
        <input
          id="category-icon"
          type="text"
          maxLength={16}
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          placeholder={formatMessage({ id: 'categoryForm.iconPlaceholder' })}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      {mergeOffer !== null && category !== undefined && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-slate-800">
            {formatMessage({ id: 'categoryForm.mergeOffer' }, {
              source: category.name,
              target: name,
              count: mergeOffer.transactionCount,
            })}
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
              {submitting
                ? formatMessage({ id: 'categoryForm.merging' })
                : confirmingMerge
                  ? formatMessage({ id: 'categoryForm.mergeConfirm' })
                  : formatMessage({ id: 'categoryForm.merge' })}
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
              {formatMessage({ id: 'categoryForm.mergeCancel' })}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          {submitting
            ? formatMessage({ id: 'categoryForm.saving' })
            : editing
              ? formatMessage({ id: 'categoryForm.save' })
              : formatMessage({ id: 'categoryForm.create' })}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-600"
        >
          {formatMessage({ id: 'categoryForm.cancel' })}
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
          {submitting
            ? formatMessage({ id: 'categoryForm.deleting' })
            : confirmingDelete
              ? formatMessage({ id: 'categoryForm.deleteConfirm' })
              : formatMessage({ id: 'categoryForm.delete' })}
        </button>
      )}
    </form>
  )
}