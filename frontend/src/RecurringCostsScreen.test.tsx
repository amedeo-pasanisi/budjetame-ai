/** Recurring Costs screen (issue #56): the list renders every cost sorted by
 * next due date, each row showing name, amount, interval, and the next due
 * date; the Backlog badge, the Overdue mark, and the summary line (issue
 * #58) ride on the API's derived state. Create, edit, and delete live in a
 * modal on this screen. The API client is mocked; the real display helpers
 * (interval text, euro formatting) stay live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringCostsScreen } from './RecurringCostsScreen'
import type { Category, RecurringCost, Wallet } from './api'

vi.mock('./api', async () => {
  const { formatEuros, formatSignedEuros } = await import('./api/format')
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  return {
    TOKEN_KEY: 'budjetame.token',
    ApiError,
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError
        ? error.status === 409
          ? conflict
          : fallback
        : fallback,
    formatEuros,
    formatSignedEuros,
    fetchRecurringCosts: vi.fn(),
    createRecurringCost: vi.fn(),
    updateRecurringCost: vi.fn(),
    deleteRecurringCost: vi.fn(),
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
    createCategory: vi.fn(),
    createWallet: vi.fn(),
  }
})

import {
  ApiError,
  createCategory,
  createRecurringCost,
  createWallet,
  deleteRecurringCost,
  fetchCategories,
  fetchRecurringCosts,
  fetchWallets,
  updateRecurringCost,
} from './api'
import { SENTINEL_VALUE } from './EntitySelect'

const createdAt = '2026-08-19T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const costs: RecurringCost[] = [
  {
    id: 1,
    name: 'Rent',
    amount: '850.00',
    wallet_id: 1,
    category_id: 1,
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 1,
    due_month: null,
    next_due_date: '2026-09-01',
    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 0,
    overdue: false,
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Coffee',
    amount: '2.50',
    wallet_id: 1,
    category_id: null,
    interval_value: 5,
    interval_unit: 'days',
    start_date: null,
    due_day: null,
    due_month: null,
    next_due_date: '2026-08-20',
    next_unpaid_occurrence_date: '2026-08-20',
    backlog_count: 3,
    overdue: true,
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Insurance',
    amount: '120.00',
    wallet_id: 2,
    category_id: null,
    interval_value: 1,
    interval_unit: 'years',
    start_date: null,
    due_day: 1,
    due_month: 12,
    next_due_date: '2026-12-01',
    next_unpaid_occurrence_date: '2026-12-01',
    backlog_count: 0,
    overdue: false,
    created_at: createdAt,
  },
]

const wallets: Wallet[] = [
  { id: 1, name: 'Intesa', type: 'checking', balance: '0.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Cash', type: 'cash', balance: '0.00', frozen: false, created_at: createdAt },
  { id: 3, name: 'Frozen', type: 'checking', balance: '0.00', frozen: true, created_at: createdAt },
  { id: 4, name: 'Marco', type: 'contact', balance: '0.00', frozen: false, created_at: createdAt },
]

const categories: Category[] = [
  { id: 1, name: 'Housing', type: 'expense', icon: null, color: '#ef4444', created_at: createdAt },
  { id: 2, name: 'Salary', type: 'income', icon: null, color: '#10b981', created_at: createdAt },
]

const fetchRecurringCostsMock = vi.mocked(fetchRecurringCosts)
const createRecurringCostMock = vi.mocked(createRecurringCost)
const updateRecurringCostMock = vi.mocked(updateRecurringCost)
const deleteRecurringCostMock = vi.mocked(deleteRecurringCost)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const createCategoryMock = vi.mocked(createCategory)
const createWalletMock = vi.mocked(createWallet)

beforeEach(() => {
  fetchRecurringCostsMock.mockResolvedValue(costs)
  fetchWalletsMock.mockResolvedValue(wallets)
  fetchCategoriesMock.mockResolvedValue(categories)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringCostsScreen rows', () => {
  it('renders every cost sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Coffee'),
      expect.stringContaining('Rent'),
      expect.stringContaining('Insurance'),
    ])
    // Each row shows the amount and the interval with the next due date.
    const texts = rows.map((row) => row.textContent ?? '')
    expect(texts[0]).toContain('€2.50')
    expect(texts[0]).toContain('Every 5 days · next due 2026-08-20')
    expect(texts[1]).toContain('€850.00')
    expect(texts[1]).toContain('Every month · next due 2026-09-01')
    expect(texts[2]).toContain('€120.00')
    expect(texts[2]).toContain('Every year · next due 2026-12-01')
  })

  it('keeps the empty state when there are no costs', async () => {
    fetchRecurringCostsMock.mockResolvedValue([])
    render(<RecurringCostsScreen />)

    expect(
      await screen.findByText("No recurring costs yet. Add your first one to track what's due."),
    ).toBeInTheDocument()
  })

  it('shows the load error when the list cannot be fetched', async () => {
    fetchRecurringCostsMock.mockRejectedValue(new Error('down'))
    render(<RecurringCostsScreen />)

    expect(
      await screen.findByText('Could not load your recurring costs.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringCostsScreen create flow', () => {
  it('creates a cost from the modal and lands it at its sorted position', async () => {
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
      amount: '45.00',
      wallet_id: 1,
      category_id: null,
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
      overdue: true,
      created_at: createdAt,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
      target: { value: 'weeks' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))

    await waitFor(() =>
      expect(createRecurringCostMock).toHaveBeenCalledWith('', {
        name: 'Gym',
        amount: '45.00',
        walletId: 1,
        categoryId: null,
        intervalValue: 1,
        intervalUnit: 'weeks',
        startDate: null,
        dueDay: null,
        dueMonth: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
      .map((row) => row.textContent)
    expect(rows[1]).toContain('Gym')
  })

  it('offers only active non-Contact wallets and expense categories', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })

    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(
      Array.from(walletSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Intesa', 'Cash', '＋ Add wallet…'])

    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    expect(
      Array.from(categorySelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['None', 'Housing', '＋ Add category…'])
  })
})

describe('RecurringCostsScreen edit and delete flows', () => {
  it('edits a cost from its row and keeps it in the sorted list', async () => {
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      next_due_date: '2026-09-01',
      next_unpaid_occurrence_date: '2026-09-01',
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Rent')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(850)
    expect(within(dialog).getByLabelText('Wallet')).toHaveValue('1')

    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRecurringCostMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ name: 'Rent', amount: '900.00' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rentRow = screen
      .getAllByRole('button')
      .find((row) => row.textContent?.includes('Rent'))
    expect(rentRow?.textContent).toContain('€900.00')
  })

  it('deletes a cost with the tap-again confirmation', async () => {
    deleteRecurringCostMock.mockResolvedValue(undefined)
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Coffee')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recurring cost' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringCostMock).toHaveBeenCalledWith('', 2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const third = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })
})

describe('RecurringCostsScreen inline category creation (issue #68)', () => {
  /** Opens the New recurring cost modal. */
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    return await screen.findByRole('dialog', { name: 'New recurring cost' })
  }

  /** The Category select's options, in order. */
  const categoryOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog)
        .getByLabelText('Category (optional)')
        .querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option, after None, in create and edit modes', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const createDialog = await openCreateForm()
    expect(categoryOptions(createDialog)).toEqual([
      'None',
      'Housing',
      '＋ Add category…',
    ])
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Edit mode carries the same sentinel.
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const editDialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    expect(categoryOptions(editDialog)).toEqual([
      'None',
      'Housing',
      '＋ Add category…',
    ])
  })

  it('picking the sentinel opens the New category modal with Expense locked and reverts the dropdown', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    // A real selection first, so the revert is observable.
    fireEvent.change(categorySelect, { target: { value: '1' } })
    expect(categorySelect).toHaveValue('1')

    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    // The Type selector is hidden and the type is fixed to Expense.
    expect(within(categoryDialog).queryByLabelText('Type')).not.toBeInTheDocument()
    expect(
      within(categoryDialog).getByText('Expense · fixed for this form'),
    ).toBeInTheDocument()
    // The dropdown reverted to its previous value; the outer draft is intact.
    expect(categorySelect).toHaveValue('1')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('')
  })

  it('the full flow — sentinel, create, auto-select, submit — carries the new category id', async () => {
    createCategoryMock.mockResolvedValue({
      id: 5,
      name: 'Groceries',
      type: 'expense',
      icon: null,
      color: '#ef4444',
      created_at: createdAt,
    })
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Grocery run',
      amount: '42.00',
      wallet_id: 1,
      category_id: 5,
      interval_value: 1,
      interval_unit: 'months',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-09-01',
      next_unpaid_occurrence_date: '2026-09-01',
      backlog_count: 0,
      overdue: false,
      created_at: createdAt,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Grocery run' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '42.00' } })

    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Groceries' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    // The Category is created with the locked Expense type.
    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith('', {
        name: 'Groceries',
        type: 'expense',
        icon: '',
        color: '#ef4444',
      }),
    )
    // Only the inner modal closes; the form and its draft survive.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Grocery run')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(42)
    // The new Category is selected and offered in the dropdown.
    await waitFor(() => expect(categorySelect).toHaveValue('5'))
    expect(categoryOptions(dialog)).toEqual([
      'None',
      'Housing',
      'Groceries',
      '＋ Add category…',
    ])
    expect(createRecurringCostMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new Category's id.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))
    await waitFor(() =>
      expect(createRecurringCostMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ name: 'Grocery run', categoryId: 5 }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the category modal and leave the form draft intact', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Grocery run' } })

    // Opens the stacked Category modal on top of the open form.
    const openCategoryModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Category (optional)'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New category' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New recurring cost' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Grocery run')
    }

    // Cancel closes only the inner modal.
    let categoryDialog = await openCategoryModal()
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // Backdrop tap closes only the inner modal.
    categoryDialog = await openCategoryModal()
    fireEvent.click(categoryDialog.previousElementSibling as Element)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // One Escape closes only the topmost modal; a second closes the form.
    categoryDialog = await openCategoryModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    formSurvives()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createCategoryMock).not.toHaveBeenCalled()
    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })

  it('a duplicate category name shows the validation error inside the modal and selects nothing', async () => {
    createCategoryMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    fireEvent.change(categorySelect, { target: { value: '1' } })
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Housing' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    expect(
      await within(categoryDialog).findByText('A category with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open and nothing is selected; the outer draft is intact.
    expect(screen.getByRole('dialog', { name: 'New category' })).toBeInTheDocument()
    expect(categorySelect).toHaveValue('1')

    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })

  it('works in edit mode: the inline Category is auto-selected and the edit carries its id', async () => {
    createCategoryMock.mockResolvedValue({
      id: 6,
      name: 'Utilities',
      type: 'expense',
      icon: null,
      color: '#ef4444',
      created_at: createdAt,
    })
    updateRecurringCostMock.mockResolvedValue({ ...costs[0], category_id: 6 })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    expect(categorySelect).toHaveValue('1')

    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Utilities' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalled())
    // The dropdown reverted to the edited cost's Category, then the new one
    // took its place; the rest of the draft (amount) is untouched.
    await waitFor(() => expect(categorySelect).toHaveValue('6'))
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(850)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateRecurringCostMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ categoryId: 6 }),
      ),
    )
  })
})

describe('RecurringCostsScreen inline wallet creation (issue #69)', () => {
  /** Opens the New recurring cost modal. */
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    return await screen.findByRole('dialog', { name: 'New recurring cost' })
  }

  /** The Wallet select's options, in order. */
  const walletOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Wallet').querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option, in create and edit modes', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const createDialog = await openCreateForm()
    expect(walletOptions(createDialog)).toEqual([
      'Intesa',
      'Cash',
      '＋ Add wallet…',
    ])
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Edit mode carries the same sentinel.
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const editDialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    expect(walletOptions(editDialog)).toEqual([
      'Intesa',
      'Cash',
      '＋ Add wallet…',
    ])
  })

  it('shows the sentinel as the only row when no eligible wallets exist', async () => {
    // Only ineligible wallets: a frozen one and a Contact one. The sentinel
    // is the only row besides the empty state, so a wallet can still be
    // created inline.
    fetchWalletsMock.mockResolvedValue([
      { id: 3, name: 'Frozen', type: 'checking', balance: '0.00', frozen: true, created_at: createdAt },
      { id: 4, name: 'Marco', type: 'contact', balance: '0.00', frozen: false, created_at: createdAt },
    ])
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    expect(walletOptions(dialog)).toEqual(['＋ Add wallet…'])
  })

  it('picking the sentinel opens the New wallet modal without Contact and reverts the dropdown', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    const walletSelect = within(dialog).getByLabelText('Wallet')
    // A real selection first, so the revert is observable.
    fireEvent.change(walletSelect, { target: { value: '2' } })
    expect(walletSelect).toHaveValue('2')

    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // The Type options are restricted to non-Contact wallets.
    const typeSelect = within(walletDialog).getByLabelText('Type')
    expect(
      Array.from(typeSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Checking', 'Credit Card', 'Cash'])
    // The dropdown reverted to its previous value; the outer draft is intact.
    expect(walletSelect).toHaveValue('2')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('')
  })

  it('the full flow — sentinel, create, auto-select, submit — carries the new wallet id', async () => {
    createWalletMock.mockResolvedValue({
      id: 7,
      name: 'Revolut',
      type: 'checking',
      balance: '0.00',
      frozen: false,
      created_at: createdAt,
    })
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
      amount: '45.00',
      wallet_id: 7,
      category_id: null,
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
      overdue: true,
      created_at: createdAt,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })

    const walletSelect = within(dialog).getByLabelText('Wallet')
    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    // The wallet is created with a non-Contact type (the default Checking).
    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '',
      }),
    )
    // Only the inner modal closes; the form and its draft survive.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Gym')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(45)
    // The new wallet is selected and offered in the dropdown.
    await waitFor(() => expect(walletSelect).toHaveValue('7'))
    expect(walletOptions(dialog)).toEqual([
      'Intesa',
      'Cash',
      'Revolut',
      '＋ Add wallet…',
    ])
    expect(createRecurringCostMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new wallet's id.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))
    await waitFor(() =>
      expect(createRecurringCostMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ name: 'Gym', walletId: 7 }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the wallet modal and leave the form draft intact', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })

    // Opens the stacked Wallet modal on top of the open form.
    const openWalletModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Wallet'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New wallet' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New recurring cost' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Gym')
    }

    // Cancel closes only the inner modal.
    let walletDialog = await openWalletModal()
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // Backdrop tap closes only the inner modal.
    walletDialog = await openWalletModal()
    fireEvent.click(walletDialog.previousElementSibling as Element)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    formSurvives()

    // One Escape closes only the topmost modal; a second closes the form.
    walletDialog = await openWalletModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    formSurvives()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createWalletMock).not.toHaveBeenCalled()
    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })

  it('a duplicate wallet name shows the validation error inside the modal and selects nothing', async () => {
    createWalletMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const dialog = await openCreateForm()
    const walletSelect = within(dialog).getByLabelText('Wallet')
    fireEvent.change(walletSelect, { target: { value: '2' } })
    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Intesa' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    expect(
      await within(walletDialog).findByText('A wallet with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open and nothing is selected; the outer draft is intact.
    expect(screen.getByRole('dialog', { name: 'New wallet' })).toBeInTheDocument()
    expect(walletSelect).toHaveValue('2')

    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New recurring cost' })).toBeInTheDocument()
    expect(createRecurringCostMock).not.toHaveBeenCalled()
  })

  it('works in edit mode: the inline Wallet is auto-selected and the edit carries its id', async () => {
    createWalletMock.mockResolvedValue({
      id: 7,
      name: 'Revolut',
      type: 'checking',
      balance: '0.00',
      frozen: false,
      created_at: createdAt,
    })
    updateRecurringCostMock.mockResolvedValue({ ...costs[0], wallet_id: 7 })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(walletSelect).toHaveValue('1')

    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() => expect(createWalletMock).toHaveBeenCalled())
    // The dropdown reverted to the edited cost's Wallet, then the new one
    // took its place; the rest of the draft (amount) is untouched.
    await waitFor(() => expect(walletSelect).toHaveValue('7'))
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(850)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateRecurringCostMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ walletId: 7 }),
      ),
    )
  })
})

describe('RecurringCostsScreen backlog, Overdue, and the summary line', () => {
  /** The row buttons, in screen order — the badge and the Overdue mark live
   * inside them. */
  const rowButtons = () =>
    screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))

  it('shows the summary line with the overdue and unpaid totals', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    expect(
      screen.getByText('1 cost overdue · 3 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('renders the badge and the Overdue mark only on a cost with a Backlog', async () => {
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const coffee = rowButtons().find((row) => row.textContent?.includes('Coffee'))
    expect(coffee?.textContent).toContain('3 unpaid')
    expect(coffee?.textContent).toContain('Overdue')

    // Rent and Insurance have no Backlog: no badge, no Overdue mark.
    const rent = rowButtons().find((row) => row.textContent?.includes('Rent'))
    expect(rent?.textContent).not.toContain('unpaid')
    expect(rent?.textContent).not.toContain('Overdue')
  })

  it('uses singular wording for one overdue cost and one unpaid occurrence', async () => {
    fetchRecurringCostsMock.mockResolvedValue([
      { ...costs[1], backlog_count: 1, overdue: true },
    ])
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    expect(
      screen.getByText('1 cost overdue · 1 unpaid occurrence'),
    ).toBeInTheDocument()
  })

  it('shows zero totals when nothing is behind, and hides the line when there are no costs', async () => {
    fetchRecurringCostsMock.mockResolvedValue([{ ...costs[0], backlog_count: 0, overdue: false }])
    render(<RecurringCostsScreen />)
    await screen.findByText('Rent')

    expect(
      screen.getByText('0 costs overdue · 0 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('updates the badge, the mark, and the summary after a definition edit', async () => {
    // The edited cost comes back with the fresh derived state: a changed
    // start date pushed two Occurrences behind it.
    updateRecurringCostMock.mockResolvedValue({
      ...costs[0],
      amount: '900.00',
      backlog_count: 2,
      overdue: true,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    const rows = rowButtons()
    fireEvent.click(rows.find((row) => row.textContent?.includes('Rent')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '900.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const rent = rowButtons().find((row) => row.textContent?.includes('Rent'))
    expect(rent?.textContent).toContain('2 unpaid')
    expect(rent?.textContent).toContain('Overdue')
    // The summary re-totals from the returned state: Rent joined Coffee.
    expect(
      screen.getByText('2 costs overdue · 5 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('shows the badge and the Overdue mark on a freshly created cost', async () => {
    createRecurringCostMock.mockResolvedValue({
      id: 9,
      name: 'Gym',
      amount: '45.00',
      wallet_id: 1,
      category_id: null,
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 1,
      overdue: true,
      created_at: createdAt,
    })
    render(<RecurringCostsScreen />)
    await screen.findByText('Coffee')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring cost' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring cost' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring cost' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const gym = rowButtons().find((row) => row.textContent?.includes('Gym'))
    expect(gym?.textContent).toContain('1 unpaid')
    expect(gym?.textContent).toContain('Overdue')
    expect(
      screen.getByText('2 costs overdue · 4 unpaid occurrences'),
    ).toBeInTheDocument()
  })
})
