/** Categories tab grouped sections, search, and the create/edit modal (#41):
 * the list renders Expenses and Incomes as two sections, each sorted A→Z
 * case-insensitively; the search bar filters both sections live by
 * case-insensitive name substring and clearing restores the full list;
 * tapping a Category opens the edit form in a modal (Type
 * fixed; backdrop, Escape, and Cancel close without saving) and "New
 * category" opens the same modal for creation (Type selectable), the new
 * Category landing at the sorted position of its section. The API client is
 * mocked; the form is driven like a user would (click, type, submit). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { CategoriesScreen } from './CategoriesScreen'
import type { Category } from './api'

vi.mock('./api', () => {
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  // The 409 a colliding rename answers (ADR-0007): a merge offer, not a bare
  // error. The form reads targetId/transactionCount; the mock mirrors the
  // real class's public shape.
  class CategoryMergeConflict extends Error {
    targetId: number
    transactionCount: number

    constructor(payload: { message: string; target_id: number; transaction_count: number }) {
      super(payload.message)
      this.targetId = payload.target_id
      this.transactionCount = payload.transaction_count
    }
  }
  return {
    TOKEN_KEY: 'budjetame.token',
    ApiError,
    CategoryMergeConflict,
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError
        ? error.status === 409
          ? conflict
          : fallback
        : fallback,
    createCategory: vi.fn(),
    deleteCategory: vi.fn(),
    fetchCategories: vi.fn(),
    mergeCategories: vi.fn(),
    updateCategory: vi.fn(),
  }
})

import {
  ApiError,
  CategoryMergeConflict,
  createCategory,
  deleteCategory,
  fetchCategories,
  mergeCategories,
  updateCategory,
} from './api'

const createdAt = '2026-08-01T10:00:00Z'

// Deliberately unsorted and mixed case: case-insensitive A→Z order is
// apple, Banana, Carrots (expenses) and freelance, Salary (incomes).
const categories: Category[] = [
  { id: 1, name: 'apple', type: 'expense', icon: '🍎', color: '#ef4444', created_at: createdAt },
  { id: 11, name: 'Salary', type: 'income', icon: '💼', color: '#3b82f6', created_at: createdAt },
  { id: 2, name: 'Banana', type: 'expense', icon: null, color: '#f97316', created_at: createdAt },
  { id: 12, name: 'freelance', type: 'income', icon: null, color: '#6366f1', created_at: createdAt },
  { id: 3, name: 'Carrots', type: 'expense', icon: null, color: '#84cc16', created_at: createdAt },
]

const fetchCategoriesMock = vi.mocked(fetchCategories)
const createCategoryMock = vi.mocked(createCategory)
const updateCategoryMock = vi.mocked(updateCategory)
const deleteCategoryMock = vi.mocked(deleteCategory)
const mergeCategoriesMock = vi.mocked(mergeCategories)

beforeEach(() => {
  fetchCategoriesMock.mockResolvedValue(categories)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CategoriesScreen header (issue #49)', () => {
  it('puts the New category button in the header row with the heading, always enabled, and no bottom button', () => {
    render(<CategoriesScreen />)

    // Asserted before the list resolves: the button needs nothing from the
    // list, so it is available while loading (issue #49).
    const heading = screen.getByRole('heading', { name: 'Categories' })
    const newCategory = within(heading.parentElement as HTMLElement).getByRole('button', {
      name: 'New category',
    })
    expect(newCategory).not.toBeDisabled()
    // The old bottom button is gone, not duplicated.
    expect(screen.queryByRole('button', { name: '+ New category' })).not.toBeInTheDocument()
  })
})

describe('CategoriesScreen sections (issue #41)', () => {
  it('groups categories into Expenses and Incomes, each sorted A→Z case-insensitively', async () => {
    render(<CategoriesScreen />)

    const expenses = await screen.findByRole('region', { name: 'Expenses' })
    const expenseRows = within(expenses).getAllByRole('button').map((b) => b.textContent)
    expect(expenseRows[0]).toContain('apple')
    expect(expenseRows[1]).toContain('Banana')
    expect(expenseRows[2]).toContain('Carrots')

    const incomes = screen.getByRole('region', { name: 'Incomes' })
    const incomeRows = within(incomes).getAllByRole('button').map((b) => b.textContent)
    expect(incomeRows[0]).toContain('freelance')
    expect(incomeRows[1]).toContain('Salary')
  })

  it('renders only the sections that have categories', async () => {
    fetchCategoriesMock.mockResolvedValue([categories[1]])
    render(<CategoriesScreen />)

    expect(
      await screen.findByRole('region', { name: 'Incomes' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Expenses' })).not.toBeInTheDocument()
  })
})

describe('CategoriesScreen search (issue #41)', () => {
  it('filters both sections live as the user types and restores the full list on clear', async () => {
    render(<CategoriesScreen />)
    await screen.findByRole('region', { name: 'Expenses' })

    const search = screen.getByRole('searchbox', { name: 'Search categories' })
    // "an" matches Banana (Expenses) and freelance (Incomes) only.
    fireEvent.change(search, { target: { value: 'an' } })

    const expenseRows = within(
      screen.getByRole('region', { name: 'Expenses' }),
    )
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(expenseRows).toHaveLength(1)
    expect(expenseRows[0]).toContain('Banana')

    const incomes = screen.getByRole('region', { name: 'Incomes' })
    const incomeRows = within(incomes).getAllByRole('button').map((b) => b.textContent)
    expect(incomeRows).toHaveLength(1)
    expect(incomeRows[0]).toContain('freelance')

    fireEvent.change(search, { target: { value: '' } })
    expect(
      within(screen.getByRole('region', { name: 'Expenses' })).getAllByRole('button'),
    ).toHaveLength(3)
    expect(
      within(screen.getByRole('region', { name: 'Incomes' })).getAllByRole('button'),
    ).toHaveLength(2)
  })

  it('matches case-insensitively, hides a section with no matches, and shows the empty message', async () => {
    render(<CategoriesScreen />)
    await screen.findByRole('region', { name: 'Expenses' })

    const search = screen.getByRole('searchbox', { name: 'Search categories' })
    // Uppercase needle: only Salary (incomes) survives.
    fireEvent.change(search, { target: { value: 'SAL' } })

    expect(screen.queryByRole('region', { name: 'Expenses' })).not.toBeInTheDocument()
    const incomes = screen.getByRole('region', { name: 'Incomes' })
    const incomeRows = within(incomes).getAllByRole('button').map((b) => b.textContent)
    expect(incomeRows).toHaveLength(1)
    expect(incomeRows[0]).toContain('Salary')

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.queryByRole('region', { name: 'Expenses' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Incomes' })).not.toBeInTheDocument()
    expect(screen.getByText('No categories match your search.')).toBeInTheDocument()
  })
})

describe('CategoriesScreen category modal (issue #41)', () => {
  const openEdit = async (name: string | RegExp) => {
    render(<CategoriesScreen />)
    const expenses = await screen.findByRole('region', { name: 'Expenses' })
    fireEvent.click(within(expenses).getByRole('button', { name }))
    return screen.findByRole('dialog', { name: 'Edit category' })
  }

  it('tapping a Category opens the edit form with the Type fixed; Escape closes without saving', async () => {
    const dialog = await openEdit(/apple/)

    expect(within(dialog).getByLabelText('Name')).toHaveValue('apple')
    // The Type is fixed when editing: no selector, just the type line.
    expect(within(dialog).queryByLabelText('Type')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Expense · type cannot be changed')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateCategoryMock).not.toHaveBeenCalled()
    // The inline form is gone: the list still shows the untouched rows.
    expect(
      within(screen.getByRole('region', { name: 'Expenses' })).getAllByRole('button'),
    ).toHaveLength(3)
  })

  it('a backdrop tap and the Cancel button close without saving', async () => {
    const dialog = await openEdit(/apple/)

    // The backdrop is the panel's sibling, rendered before it.
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateCategoryMock).not.toHaveBeenCalled()

    fireEvent.click(
      within(screen.getByRole('region', { name: 'Expenses' })).getByRole('button', {
        name: /apple/,
      }),
    )
    const reopened = await screen.findByRole('dialog', { name: 'Edit category' })
    fireEvent.click(within(reopened).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateCategoryMock).not.toHaveBeenCalled()
  })

  it('saving an edit updates the Category, closes the modal, and keeps the row in place', async () => {
    updateCategoryMock.mockResolvedValue({ ...categories[0], name: 'Apple' })
    const dialog = await openEdit(/apple/)

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Apple' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateCategoryMock).toHaveBeenCalledWith('', 1, {
        name: 'Apple',
        icon: '🍎',
        color: '#ef4444',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const expenseRows = within(screen.getByRole('region', { name: 'Expenses' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(expenseRows[0]).toContain('Apple')
  })

  it('"New category" opens the create form with a selectable Type; the new Category lands at the sorted position of its section', async () => {
    createCategoryMock.mockResolvedValue({
      id: 13,
      name: 'Household',
      type: 'income',
      icon: '',
      color: '#ef4444',
      created_at: createdAt,
    })
    render(<CategoriesScreen />)
    await screen.findByRole('region', { name: 'Incomes' })

    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    const dialog = await screen.findByRole('dialog', { name: 'New category' })
    const typeSelect = within(dialog).getByLabelText('Type')
    expect(typeSelect).toHaveValue('expense')
    expect(
      Array.from(typeSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Expense', 'Income'])

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Household' },
    })
    fireEvent.change(typeSelect, { target: { value: 'income' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create category' }))

    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith('', {
        name: 'Household',
        type: 'income',
        icon: '',
        color: '#ef4444',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const incomeRows = within(screen.getByRole('region', { name: 'Incomes' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(incomeRows).toHaveLength(3)
    expect(incomeRows[0]).toContain('freelance')
    expect(incomeRows[1]).toContain('Household')
    expect(incomeRows[2]).toContain('Salary')
  })

  it('delete still works from the edit modal with the tap-again confirmation', async () => {
    deleteCategoryMock.mockResolvedValue(undefined)
    const dialog = await openEdit(/apple/)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete category' }))
    expect(
      within(dialog).getByRole('button', { name: 'Tap again to confirm' }),
    ).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteCategoryMock).toHaveBeenCalledWith('', 1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      within(screen.getByRole('region', { name: 'Expenses' })).queryByRole('button', {
        name: /apple/,
      }),
    ).not.toBeInTheDocument()
  })
})

describe('CategoriesScreen merge confirm flow (issue #45)', () => {
  // Renaming apple (id 1) to Banana collides with Banana (id 2): the
  // backend's 409 carries the surviving Category's id and the count of
  // Transactions that would move (ADR-0007).
  const bananaConflict = new CategoryMergeConflict({
    message: 'A Category with this name already exists',
    target_id: 2,
    transaction_count: 7,
  })

  const openEdit = async (name: string | RegExp) => {
    render(<CategoriesScreen />)
    const expenses = await screen.findByRole('region', { name: 'Expenses' })
    fireEvent.click(within(expenses).getByRole('button', { name }))
    return screen.findByRole('dialog', { name: 'Edit category' })
  }

  const renameIntoBanana = async () => {
    updateCategoryMock.mockRejectedValue(bananaConflict)
    const dialog = await openEdit(/apple/)
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Banana' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    return dialog
  }

  it('a colliding rename shows the merge offer with the count; cancelling it keeps the draft and both Categories', async () => {
    const dialog = await renameIntoBanana()

    expect(
      await within(dialog).findByText(
        /Merge apple into Banana\? 7 transactions will move — this cannot be undone\./,
      ),
    ).toBeInTheDocument()
    expect(mergeCategoriesMock).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel merge' }))
    expect(within(dialog).queryByText(/Merge apple into Banana/)).not.toBeInTheDocument()
    // The edit draft is untouched and the modal stays open.
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Banana')
    expect(screen.getByRole('dialog', { name: 'Edit category' })).toBeInTheDocument()
    expect(mergeCategoriesMock).not.toHaveBeenCalled()
    // Both Categories still listed, unchanged.
    const expenseRows = within(screen.getByRole('region', { name: 'Expenses' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(expenseRows).toHaveLength(3)
    expect(expenseRows[0]).toContain('apple')
    expect(expenseRows[1]).toContain('Banana')
  })

  it('confirming with tap-again runs the merge; the list shows only the surviving Category', async () => {
    mergeCategoriesMock.mockResolvedValue({ ...categories[1] })
    const dialog = await renameIntoBanana()
    await within(dialog).findByText(/Merge apple into Banana/)

    // The first tap arms the destructive action, the second executes it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }))
    const armed = within(dialog).getByRole('button', { name: 'Tap again to confirm' })
    expect(mergeCategoriesMock).not.toHaveBeenCalled()
    fireEvent.click(armed)

    await waitFor(() => expect(mergeCategoriesMock).toHaveBeenCalledWith('', 1, 2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const expenseRows = within(screen.getByRole('region', { name: 'Expenses' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(expenseRows).toHaveLength(2)
    expect(expenseRows[0]).toContain('Banana')
    expect(expenseRows[1]).toContain('Carrots')
  })

  it('a failed merge shows the server error inline in the modal and keeps the confirmation', async () => {
    mergeCategoriesMock.mockRejectedValue(new ApiError('boom', 500))
    const dialog = await renameIntoBanana()
    await within(dialog).findByText(/Merge apple into Banana/)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    expect(await within(dialog).findByText('Could not merge the categories.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit category' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Merge apple into Banana/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Banana')
  })
})
