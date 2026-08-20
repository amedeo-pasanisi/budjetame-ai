/** Recurring Incomes screen (issue #60): the Incomes side of the Recurring
 * tab renders every income sorted by next due date, each row showing name,
 * amount, interval, and the next due date (derived on the backend, override
 * applied); the Backlog badge, the Overdue mark, and the summary line (issue
 * #62) ride on the API's derived state. Create, edit, and delete live in a
 * modal on this screen, mirroring the Costs side (ADR-0011). The API client
 * is mocked; the real display helpers (interval text, euro formatting) stay
 * live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { RecurringIncomesScreen } from './RecurringIncomesScreen'
import type { Category, RecurringIncome, Wallet } from './api'

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
    fetchRecurringIncomes: vi.fn(),
    createRecurringIncome: vi.fn(),
    updateRecurringIncome: vi.fn(),
    deleteRecurringIncome: vi.fn(),
    fetchWallets: vi.fn(),
    fetchCategories: vi.fn(),
    createCategory: vi.fn(),
    createWallet: vi.fn(),
  }
})

import {
  ApiError,
  createCategory,
  createRecurringIncome,
  createWallet,
  deleteRecurringIncome,
  fetchCategories,
  fetchRecurringIncomes,
  fetchWallets,
  updateRecurringIncome,
} from './api'
import { SENTINEL_VALUE } from './EntitySelect'

const createdAt = '2026-08-20T10:00:00Z'

// Deliberately unsorted: the screen's one order is next due date ascending.
const incomes: RecurringIncome[] = [
  {
    id: 1,
    name: 'Salary',
    amount: '2100.00',
    wallet_id: 1,
    category_id: 1,
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 27,
    due_month: null,
    next_due_date: '2026-09-27',

    next_unpaid_occurrence_date: '2026-09-27',
    backlog_count: 0,
    overdue: false,
    created_at: createdAt,
  },
  {
    id: 2,
    name: 'Rent from Marco',
    amount: '600.00',
    wallet_id: 1,
    category_id: null,
    interval_value: 1,
    interval_unit: 'months',
    start_date: null,
    due_day: 1,
    due_month: null,
    next_due_date: '2026-09-01',

    next_unpaid_occurrence_date: '2026-09-01',
    backlog_count: 3,
    overdue: true,
    created_at: createdAt,
  },
  {
    id: 3,
    name: 'Bonus',
    amount: '1500.00',
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
  { id: 1, name: 'Salary', type: 'income', icon: null, color: '#10b981', created_at: createdAt },
  { id: 2, name: 'Housing', type: 'expense', icon: null, color: '#ef4444', created_at: createdAt },
]

const fetchRecurringIncomesMock = vi.mocked(fetchRecurringIncomes)
const createRecurringIncomeMock = vi.mocked(createRecurringIncome)
const updateRecurringIncomeMock = vi.mocked(updateRecurringIncome)
const deleteRecurringIncomeMock = vi.mocked(deleteRecurringIncome)
const fetchWalletsMock = vi.mocked(fetchWallets)
const fetchCategoriesMock = vi.mocked(fetchCategories)
const createCategoryMock = vi.mocked(createCategory)
const createWalletMock = vi.mocked(createWallet)

beforeEach(() => {
  fetchRecurringIncomesMock.mockResolvedValue(incomes)
  fetchWalletsMock.mockResolvedValue(wallets)
  fetchCategoriesMock.mockResolvedValue(categories)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('RecurringIncomesScreen rows', () => {
  it('renders every income sorted by next due date with name, amount, interval, and due date', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Rent from Marco'),
      expect.stringContaining('Salary'),
      expect.stringContaining('Bonus'),
    ])
    // Each row shows the amount and the interval with the next due date.
    const texts = rows.map((row) => row.textContent ?? '')
    expect(texts[0]).toContain('€600.00')
    expect(texts[0]).toContain('Every month · next due 2026-09-01')
    expect(texts[1]).toContain('€2100.00')
    expect(texts[1]).toContain('Every month · next due 2026-09-27')
    expect(texts[2]).toContain('€1500.00')
    expect(texts[2]).toContain('Every year · next due 2026-12-01')
  })

  it('keeps the empty state when there are no incomes', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([])
    render(<RecurringIncomesScreen />)

    expect(
      await screen.findByText("No recurring incomes yet. Add your first one to track what's due."),
    ).toBeInTheDocument()
  })

  it('shows the load error when the list cannot be fetched', async () => {
    fetchRecurringIncomesMock.mockRejectedValue(new Error('down'))
    render(<RecurringIncomesScreen />)

    expect(
      await screen.findByText('Could not load your recurring incomes.'),
    ).toBeInTheDocument()
  })
})

describe('RecurringIncomesScreen create flow', () => {
  it('creates an income from the modal and lands it at its sorted position', async () => {
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Freelance',
      amount: '800.00',
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
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '800.00' } })
    fireEvent.change(within(dialog).getByLabelText('Interval unit'), {
      target: { value: 'weeks' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))

    await waitFor(() =>
      expect(createRecurringIncomeMock).toHaveBeenCalledWith('', {
        name: 'Freelance',
        amount: '800.00',
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
    expect(rows[0]).toContain('Freelance')
  })

  it('offers only active non-Contact wallets and income categories', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })

    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(
      Array.from(walletSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Intesa', 'Cash', '＋ Add wallet…'])

    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    expect(
      Array.from(categorySelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['None', 'Salary', '＋ Add category…'])
  })
})

describe('RecurringIncomesScreen inline category creation (issue #70)', () => {
  /** Opens the New recurring income modal. */
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    return await screen.findByRole('dialog', { name: 'New recurring income' })
  }

  /** The Category select's options, in order. */
  const categoryOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog)
        .getByLabelText('Category (optional)')
        .querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option, after None, in create and edit modes', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const createDialog = await openCreateForm()
    expect(categoryOptions(createDialog)).toEqual([
      'None',
      'Salary',
      '＋ Add category…',
    ])
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Edit mode carries the same sentinel.
    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const editDialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    expect(categoryOptions(editDialog)).toEqual([
      'None',
      'Salary',
      '＋ Add category…',
    ])
  })

  it('picking the sentinel opens the New category modal with Income locked and reverts the dropdown', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    // A real selection first, so the revert is observable.
    fireEvent.change(categorySelect, { target: { value: '1' } })
    expect(categorySelect).toHaveValue('1')

    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    // The Type selector is hidden and the type is fixed to Income.
    expect(within(categoryDialog).queryByLabelText('Type')).not.toBeInTheDocument()
    expect(
      within(categoryDialog).getByText('Income · fixed for this form'),
    ).toBeInTheDocument()
    // The dropdown reverted to its previous value; the outer draft is intact.
    expect(categorySelect).toHaveValue('1')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('')
  })

  it('the full flow — sentinel, create, auto-select, submit — carries the new category id', async () => {
    createCategoryMock.mockResolvedValue({
      id: 5,
      name: 'Side gig',
      type: 'income',
      icon: null,
      color: '#10b981',
      created_at: createdAt,
    })
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Freelance',
      amount: '800.00',
      wallet_id: 1,
      category_id: 5,
      interval_value: 1,
      interval_unit: 'weeks',
      start_date: null,
      due_day: null,
      due_month: null,
      next_due_date: '2026-08-24',
      next_unpaid_occurrence_date: '2026-08-24',
      backlog_count: 0,
      overdue: false,
      created_at: createdAt,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '800.00' } })

    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Side gig' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    // The Category is created with the locked Income type (and the form's
    // default preset color).
    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith('', {
        name: 'Side gig',
        type: 'income',
        icon: '',
        color: '#ef4444',
      }),
    )
    // Only the inner modal closes; the form and its draft survive.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'New recurring income' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Freelance')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(800)
    // The new Category is selected and offered in the dropdown.
    await waitFor(() => expect(categorySelect).toHaveValue('5'))
    expect(categoryOptions(dialog)).toEqual([
      'None',
      'Salary',
      'Side gig',
      '＋ Add category…',
    ])
    expect(createRecurringIncomeMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new Category's id.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))
    await waitFor(() =>
      expect(createRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ name: 'Freelance', categoryId: 5 }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the category modal and leave the form draft intact', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })

    // Opens the stacked Category modal on top of the open form.
    const openCategoryModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Category (optional)'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New category' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New recurring income' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Freelance')
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
    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
  })

  it('a duplicate category name shows the validation error inside the modal and selects nothing', async () => {
    createCategoryMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    fireEvent.change(categorySelect, { target: { value: '1' } })
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Salary' },
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
    expect(screen.getByRole('dialog', { name: 'New recurring income' })).toBeInTheDocument()
    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
  })

  it('works in edit mode: the inline Category is auto-selected and the edit carries its id', async () => {
    createCategoryMock.mockResolvedValue({
      id: 6,
      name: 'Investments',
      type: 'income',
      icon: null,
      color: '#10b981',
      created_at: createdAt,
    })
    updateRecurringIncomeMock.mockResolvedValue({ ...incomes[0], category_id: 6 })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    const categorySelect = within(dialog).getByLabelText('Category (optional)')
    expect(categorySelect).toHaveValue('1')

    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Investments' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    await waitFor(() => expect(createCategoryMock).toHaveBeenCalled())
    // The dropdown reverted to the edited income's Category, then the new one
    // took its place; the rest of the draft (amount) is untouched.
    await waitFor(() => expect(categorySelect).toHaveValue('6'))
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(2100)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ categoryId: 6 }),
      ),
    )
  })
})

describe('RecurringIncomesScreen inline wallet creation (issue #70)', () => {
  /** Opens the New recurring income modal. */
  const openCreateForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    return await screen.findByRole('dialog', { name: 'New recurring income' })
  }

  /** The Wallet select's options, in order. */
  const walletOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Wallet').querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('shows the sentinel as the last option, in create and edit modes', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

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
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const editDialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
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
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    expect(walletOptions(dialog)).toEqual(['＋ Add wallet…'])
  })

  it('picking the sentinel opens the New wallet modal without Contact and reverts the dropdown', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

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
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Freelance',
      amount: '800.00',
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
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '800.00' } })

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
    expect(screen.getByRole('dialog', { name: 'New recurring income' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Freelance')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(800)
    // The new wallet is selected and offered in the dropdown.
    await waitFor(() => expect(walletSelect).toHaveValue('7'))
    expect(walletOptions(dialog)).toEqual([
      'Intesa',
      'Cash',
      'Revolut',
      '＋ Add wallet…',
    ])
    expect(createRecurringIncomeMock).not.toHaveBeenCalled()

    // Submitting the outer form sends the new wallet's id.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))
    await waitFor(() =>
      expect(createRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ name: 'Freelance', walletId: 7 }),
      ),
    )
  })

  it('Cancel, backdrop tap, and Escape close only the wallet modal and leave the form draft intact', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const dialog = await openCreateForm()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Freelance' } })

    // Opens the stacked Wallet modal on top of the open form.
    const openWalletModal = async () => {
      fireEvent.change(within(dialog).getByLabelText('Wallet'), {
        target: { value: SENTINEL_VALUE },
      })
      return await screen.findByRole('dialog', { name: 'New wallet' })
    }
    const formSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'New recurring income' })).toBeInTheDocument()
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Freelance')
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
    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
  })

  it('a duplicate wallet name shows the validation error inside the modal and selects nothing', async () => {
    createWalletMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

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
    expect(screen.getByRole('dialog', { name: 'New recurring income' })).toBeInTheDocument()
    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
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
    updateRecurringIncomeMock.mockResolvedValue({ ...incomes[0], wallet_id: 7 })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(walletSelect).toHaveValue('1')

    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() => expect(createWalletMock).toHaveBeenCalled())
    // The dropdown reverted to the edited income's Wallet, then the new one
    // took its place; the rest of the draft (amount) is untouched.
    await waitFor(() => expect(walletSelect).toHaveValue('7'))
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(2100)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ walletId: 7 }),
      ),
    )
  })
})

describe('RecurringIncomesScreen edit and delete flows', () => {
  it('edits an income from its row and keeps it in the sorted list', async () => {
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      next_due_date: '2026-09-27',

      next_unpaid_occurrence_date: '2026-09-27',
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Salary')
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(2100)
    expect(within(dialog).getByLabelText('Wallet')).toHaveValue('1')

    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateRecurringIncomeMock).toHaveBeenCalledWith(
        '',
        1,
        expect.objectContaining({ name: 'Salary', amount: '2200.00' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const salaryRow = screen
      .getAllByRole('button')
      .find((row) => row.textContent?.includes('Salary'))
    expect(salaryRow?.textContent).toContain('€2200.00')
  })

  it('deletes an income with the tap-again confirmation', async () => {
    deleteRecurringIncomeMock.mockResolvedValue(undefined)
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))
    fireEvent.click(rows.find((row) => row.textContent?.includes('Bonus')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete recurring income' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm' }))

    await waitFor(() => expect(deleteRecurringIncomeMock).toHaveBeenCalledWith('', 3))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('Bonus')).not.toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const third = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createRecurringIncomeMock).not.toHaveBeenCalled()
  })
})

describe('RecurringIncomesScreen backlog, Overdue, and the summary line', () => {
  /** The row buttons, in screen order — the badge and the Overdue mark live
   * inside them. */
  const rowButtons = () =>
    screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('rounded-2xl'))

  it('shows the summary line with the overdue and unpaid totals', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    expect(
      screen.getByText('1 income overdue · 3 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('renders the badge and the Overdue mark only on an income with a Backlog', async () => {
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const marco = rowButtons().find((row) => row.textContent?.includes('Rent from Marco'))
    expect(marco?.textContent).toContain('3 unpaid')
    expect(marco?.textContent).toContain('Overdue')

    // Salary and Bonus have no Backlog: no badge, no Overdue mark.
    const salary = rowButtons().find((row) => row.textContent?.includes('Salary'))
    expect(salary?.textContent).not.toContain('unpaid')
    expect(salary?.textContent).not.toContain('Overdue')
  })

  it('uses singular wording for one overdue income and one unpaid occurrence', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([
      { ...incomes[1], backlog_count: 1, overdue: true },
    ])
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    expect(
      screen.getByText('1 income overdue · 1 unpaid occurrence'),
    ).toBeInTheDocument()
  })

  it('shows zero totals when nothing is behind, and hides the line when there are no incomes', async () => {
    fetchRecurringIncomesMock.mockResolvedValue([
      { ...incomes[0], backlog_count: 0, overdue: false },
    ])
    render(<RecurringIncomesScreen />)
    await screen.findByText('Salary')

    expect(
      screen.getByText('0 incomes overdue · 0 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('updates the badge, the mark, and the summary after a definition edit', async () => {
    // The edited income comes back with the fresh derived state: a changed
    // start date pushed two Occurrences behind it.
    updateRecurringIncomeMock.mockResolvedValue({
      ...incomes[0],
      amount: '2200.00',
      backlog_count: 2,
      overdue: true,
    })
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    const rows = rowButtons()
    fireEvent.click(rows.find((row) => row.textContent?.includes('Salary')) as HTMLElement)
    const dialog = await screen.findByRole('dialog', { name: 'Edit recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '2200.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const salary = rowButtons().find((row) => row.textContent?.includes('Salary'))
    expect(salary?.textContent).toContain('2 unpaid')
    expect(salary?.textContent).toContain('Overdue')
    // The summary re-totals from the returned state: Salary joined Marco.
    expect(
      screen.getByText('2 incomes overdue · 5 unpaid occurrences'),
    ).toBeInTheDocument()
  })

  it('shows the badge and the Overdue mark on a freshly created income', async () => {
    createRecurringIncomeMock.mockResolvedValue({
      id: 9,
      name: 'Gym Rental',
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
    render(<RecurringIncomesScreen />)
    await screen.findByText('Rent from Marco')

    fireEvent.click(screen.getByRole('button', { name: 'New recurring income' }))
    const dialog = await screen.findByRole('dialog', { name: 'New recurring income' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Gym Rental' } })
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '45.00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create recurring income' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const gym = rowButtons().find((row) => row.textContent?.includes('Gym Rental'))
    expect(gym?.textContent).toContain('1 unpaid')
    expect(gym?.textContent).toContain('Overdue')
    expect(
      screen.getByText('2 incomes overdue · 4 unpaid occurrences'),
    ).toBeInTheDocument()
  })
})
