import { useEffect, useMemo, useState } from 'react'

import { TOKEN_KEY, fetchCategories, type Category, type CategoryType } from './api'
import { CategoryModal } from './CategoryModal'

const TYPE_LABELS: Record<CategoryType, string> = {
  expense: 'Expense',
  income: 'Income',
}

const SECTION_LABELS: Record<CategoryType, string> = {
  expense: 'Expenses',
  income: 'Incomes',
}

const SECTION_TYPES: CategoryType[] = ['expense', 'income']

/** The modal's draft: create (no Category) or edit (a Category). Null means
 * the modal is closed. Create and edit share the one bottom-sheet modal
 * (issue #41). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; category: Category }

/** The Categories tab (issue #41): the list is two sections — Expenses and
 * Incomes — each sorted A→Z case-insensitively, under a search bar that
 * filters both sections live by case-insensitive name substring. Creating
 * and editing happen in a bottom-sheet modal, replacing the inline form at
 * the end of the list. */
export function CategoriesScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalDraft | null>(null)

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

  // Create and edit share one save path: upsert the saved Category and close
  // the modal.
  const handleSaved = (category: Category) => {
    setCategories((current) => {
      if (current === null) {
        return [category]
      }
      return current.some((existing) => existing.id === category.id)
        ? current.map((existing) => (existing.id === category.id ? category : existing))
        : [...current, category]
    })
    setModal(null)
  }

  const handleDeleted = (categoryId: number) => {
    setCategories((current) =>
      current === null ? current : current.filter((c) => c.id !== categoryId),
    )
    setModal(null)
  }

  // The sections are derived at render time: filter by the search needle
  // (case-insensitive substring, live) and sort A→Z case-insensitively, so a
  // new Category lands at the sorted position of its section automatically.
  const sections = useMemo(() => {
    if (categories === null) {
      return null
    }
    const needle = query.trim().toLowerCase()
    const filtered =
      needle === ''
        ? categories
        : categories.filter((category) => category.name.toLowerCase().includes(needle))
    return SECTION_TYPES.map((type) => ({
      type,
      label: SECTION_LABELS[type],
      items: filtered
        .filter((category) => category.type === type)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    }))
  }, [categories, query])

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
        <>
          <div className="mt-3">
            <input
              aria-label="Search categories"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search categories…"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {sections !== null && sections.every((section) => section.items.length === 0) ? (
            <p className="mt-3 text-sm text-slate-500">No categories match your search.</p>
          ) : (
            sections?.map((section) =>
              section.items.length === 0 ? null : (
                <section
                  key={section.type}
                  aria-labelledby={`categories-${section.type}`}
                  className="mt-5"
                >
                  <h3
                    id={`categories-${section.type}`}
                    className="text-sm font-medium text-slate-700"
                  >
                    {section.label}
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {section.items.map((category) => (
                      <li key={category.id}>
                        <button
                          type="button"
                          onClick={() => setModal({ kind: 'edit', category })}
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
                </section>
              ),
            )
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => setModal({ kind: 'create' })}
        className="mt-5 w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
      >
        + New category
      </button>

      {modal !== null && (
        <CategoryModal
          category={modal.kind === 'edit' ? modal.category : undefined}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
