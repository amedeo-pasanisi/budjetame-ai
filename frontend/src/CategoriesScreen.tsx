import { useEffect, useMemo, useState } from 'react'

import type { LedgerFilterRequest } from './App'
import { TOKEN_KEY, fetchCategories, type Category, type CategoryType } from './api'
import { useDataVersion } from './api/dataVersion'
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
 * the modal is closed. Create and edit share the one modal (issue #41). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; category: Category }

/** The Categories tab (issue #41): the list is two sections — Expenses and
 * Incomes — each sorted A→Z case-insensitively, under a search bar that
 * filters both sections live by case-insensitive name substring. Creating
 * and editing happen in a modal, replacing the inline form at
 * the end of the list.
 *
 * Row structure (issue #94): a row is a main tap surface with a sibling
 * trailing ✎ button inside one card — nested buttons are illegal. The tap
 * surface (color dot + name + type) sends the ledger jump (issue #90): the
 * shell opens the Transactions tab pre-filtered to that Category, and the
 * ledger's Category filter covers expense and income alike. The trailing
 * ✎ opens the edit modal (rename/delete/merge, ADR-0007) — the old
 * whole-row edit semantics moved here. */
export function CategoriesScreen({
  requestLedgerFilter,
}: {
  /** Send a ledger jump (issue #90): open the Transactions tab with the
   * ledger pre-filtered to one Category. Fired by the whole-row tap
   * surface (issue #94). */
  requestLedgerFilter?: (request: LedgerFilterRequest) => void
}) {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalDraft | null>(null)
  // The cache clock (ADR-0022): a write anywhere re-fetches this list in
  // the background, so the tab is never stale when switched back to.
  const dataVersion = useDataVersion()

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
  }, [token, dataVersion])

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

  // A merge removes the renamed Category and returns the surviving one
  // (ADR-0007): the list ends up with exactly the survivor, in place.
  const handleMerged = (deletedId: number, surviving: Category) => {
    setCategories((current) =>
      current === null
        ? [surviving]
        : current
            .filter((existing) => existing.id !== deletedId)
            .map((existing) => (existing.id === surviving.id ? surviving : existing)),
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
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Categories</h2>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          New category
        </button>
      </div>

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
                        {/* A row is a tap surface plus a sibling trailing ✎
                            (issue #94): the card holds the surface and the
                            button side by side — nested buttons are
                            illegal. The whole surface (dot + name + type)
                            is the ledger jump; ✎ opens the edit modal
                            (rename/delete/merge, ADR-0007). */}
                        <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                          <button
                            type="button"
                            onClick={() =>
                              requestLedgerFilter?.({ kind: 'category', id: category.id })
                            }
                            className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
                          >
                            <span
                              aria-hidden="true"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base"
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
                          <button
                            type="button"
                            aria-label={`Edit ${category.name}`}
                            onClick={() => setModal({ kind: 'edit', category })}
                            className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
                          >
                            ✎
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )
          )}
        </>
      )}

      {modal !== null && (
        <CategoryModal
          category={modal.kind === 'edit' ? modal.category : undefined}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onMerged={handleMerged}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
