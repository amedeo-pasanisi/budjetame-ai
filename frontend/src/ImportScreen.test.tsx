/** Import preview sticky confirm bar (issue #42): while the row list is long,
 * a footer pinned to the bottom keeps the ready/duplicate/problem counts and
 * the Import button visible; the button reflects the selection ("Nothing to
 * import" disabled at zero, "Import N rows" otherwise) and imports exactly
 * the selected rows; "Pick another file" stays above the list, out of the
 * bar.
 *
 * Import row editor (issue #46): tapping any row opens a modal
 * prefilled with its fields; saving re-validates the edited row server-side
 * and flips its status inline, auto-selecting rows that become Ready and
 * deselecting ones that stop being Ready; confirm sends the edited values.
 *
 * Import row editor entity selects and inline creation (issue #77): the
 * Wallet and Category fields are dropdowns of the Account's entities with a
 * trailing "＋ Add…" sentinel; picking it opens the create modal stacked on
 * the editor, prefilled with the row's missing name; submitting creates the
 * entity for real, closes only the modal, and auto-selects it in the
 * originating field.
 *
 * Import inline-creation Revalidation (issue #78): creating a Wallet or
 * Category from the row editor re-validates, in one batch call, every
 * problem row whose wallet-kind field (Wallet, From, To) or Category field
 * case-insensitively references the created name — flips to Ready
 * (auto-selected), Duplicate (unselectable), or a narrowed Problem — and
 * leaves hand-verified and unrelated rows untouched.
 *
 * The API client is mocked; the screen is driven like a user would (pick a
 * file, read, toggle, edit a row, confirm). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { ImportScreen } from './ImportScreen'
import { useImportDraft } from './importDraft'
import type { Category, ImportPreview, ImportRowInput, Transaction, Wallet } from './api'

vi.mock('./api', () => {
  class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }

  class CategoryMergeConflict extends Error {}

  return {
    ApiError,
    CategoryMergeConflict,
    TOKEN_KEY: 'budjetame.token',
    apiErrorMessage: (error: unknown, conflict: string, fallback: string) =>
      error instanceof ApiError ? (error.status === 409 ? conflict : fallback) : fallback,
    formatEuros: (value: string) => `€${value}`,
    previewImport: vi.fn(),
    confirmImport: vi.fn(),
    validateImportRow: vi.fn(),
    revalidateImportRows: vi.fn(),
    createWallet: vi.fn(),
    freezeWallet: vi.fn(),
    renameWallet: vi.fn(),
    createCategory: vi.fn(),
    deleteCategory: vi.fn(),
    updateCategory: vi.fn(),
    mergeCategories: vi.fn(),
  }
})

import {
  ApiError,
  confirmImport,
  createCategory,
  createWallet,
  previewImport,
  revalidateImportRows,
  validateImportRow,
} from './api'
import { SENTINEL_VALUE } from './EntitySelect'

const previewImportMock = vi.mocked(previewImport)
const confirmImportMock = vi.mocked(confirmImport)
const validateImportRowMock = vi.mocked(validateImportRow)
const revalidateImportRowsMock = vi.mocked(revalidateImportRows)
const createWalletMock = vi.mocked(createWallet)
const createCategoryMock = vi.mocked(createCategory)

/** Two ready rows (auto-selected), one duplicate, one problem. */
const preview: ImportPreview = {
  rows: [
    {
      row: 1,
      status: 'ok',
      type: 'expense',
      date: '2026-08-01',
      amount: '4.50',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: 'Coffee',
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 2,
      status: 'ok',
      type: 'income',
      date: '2026-08-02',
      amount: '100.00',
      wallet: 'Bank',
      source_wallet: null,
      destination_wallet: null,
      category: 'Salary',
      description: null,
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 3,
      status: 'duplicate',
      type: 'expense',
      date: '2026-08-01',
      amount: '4.50',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: 'Coffee',
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 4,
      status: 'error',
      type: 'expense',
      date: '2026-08-03',
      amount: '12.00',
      wallet: 'Unknown',
      source_wallet: null,
      destination_wallet: null,
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'Unknown'",
    },
  ],
  ok_count: 2,
  error_count: 1,
  duplicate_count: 1,
}

const importedTransaction: Transaction = {
  id: 9,
  type: 'income',
  amount: '100.00',
  date: '2026-08-02',
  wallet_id: 2,
  source_wallet_id: null,
  destination_wallet_id: null,
  category_id: null,
  recurring_cost_id: null,
  recurring_income_id: null,
  occurrence_date: null,
  description: null,
  latitude: null,
  longitude: null,
  place_name: null,
  place_id: null,
  warning: false,
  created_at: '2026-08-02T10:00:00Z',
}

/** The Account's Wallets the row editor offers (issue #77): the two the file
 * references plus a Contact one that only a Transfer's From/To may offer. */
const wallets: Wallet[] = [
  {
    id: 1,
    name: 'Cash',
    type: 'cash',
    balance: '100.00',
    frozen: false,
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Bank',
    type: 'checking',
    balance: '500.00',
    frozen: false,
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 3,
    name: 'Marco',
    type: 'contact',
    balance: '0.00',
    frozen: false,
    created_at: '2026-08-01T00:00:00Z',
  },
]

/** The Account's Categories: one per type, matching the file's names. */
const categories: Category[] = [
  {
    id: 1,
    name: 'Food',
    type: 'expense',
    icon: '🍔',
    color: '#ef4444',
    created_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 2,
    name: 'Salary',
    type: 'income',
    icon: null,
    color: '#3b82f6',
    created_at: '2026-08-01T00:00:00Z',
  },
]

/** The Wallet the inline create flow returns (issue #77). */
const revolutWallet: Wallet = {
  id: 7,
  name: 'Revolut',
  type: 'checking',
  balance: '0.00',
  frozen: false,
  created_at: '2026-08-05T00:00:00Z',
}

/** The Category the inline create flow returns. */
const billsCategory: Category = {
  id: 5,
  name: 'Bills',
  type: 'income',
  icon: null,
  color: '#ef4444',
  created_at: '2026-08-05T00:00:00Z',
}

/** The Wallet Revalidation fixture (issue #78): problem rows referencing a
 * missing Wallet under different spellings, through a Transfer's From and
 * To, and alongside a second problem (a missing Category); a problem row
 * about something else entirely; plus ready and duplicate rows that must
 * stay untouched. Rows 2 and 3 are the same Transaction except for the
 * Wallet's case — the in-file Duplicate pair (AC: the first flips Ready,
 * the second Duplicate). */
const revalidationPreview: ImportPreview = {
  rows: [
    {
      row: 1,
      status: 'ok',
      type: 'expense',
      date: '2026-08-01',
      amount: '4.50',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: 'Coffee',
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 2,
      status: 'error',
      type: 'expense',
      date: '2026-08-04',
      amount: '20.00',
      wallet: 'Unknown',
      source_wallet: null,
      destination_wallet: null,
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'Unknown'",
    },
    {
      row: 3,
      status: 'error',
      type: 'expense',
      date: '2026-08-04',
      amount: '20.00',
      wallet: 'unknown',
      source_wallet: null,
      destination_wallet: null,
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'unknown'",
    },
    {
      row: 4,
      status: 'error',
      type: 'transfer',
      date: '2026-08-05',
      amount: '30.00',
      wallet: null,
      source_wallet: 'Unknown',
      destination_wallet: 'Cash',
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'Unknown'",
    },
    {
      row: 5,
      status: 'error',
      type: 'transfer',
      date: '2026-08-06',
      amount: '30.00',
      wallet: null,
      source_wallet: 'Cash',
      destination_wallet: 'unknown',
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'unknown'",
    },
    {
      row: 6,
      status: 'error',
      type: 'expense',
      date: '2026-08-07',
      amount: '9.00',
      wallet: 'Unknown',
      source_wallet: null,
      destination_wallet: null,
      category: 'Nope',
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'Unknown'",
    },
    {
      row: 7,
      status: 'error',
      type: 'income',
      date: '2026-08-08',
      amount: '50.00',
      wallet: 'Bank',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: null,
      latitude: null,
      longitude: null,
      error: "Category 'Food' is an expense category, not income",
    },
    {
      row: 8,
      status: 'duplicate',
      type: 'expense',
      date: '2026-08-01',
      amount: '4.50',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Food',
      description: 'Coffee',
      latitude: null,
      longitude: null,
      error: null,
    },
  ],
  ok_count: 1,
  error_count: 6,
  duplicate_count: 1,
}

/** The revalidation fixture's rows 1-8 as the wire's ImportRowInput
 * literals — the batch call must carry every draft row as the in-file
 * Duplicate context, written independently of the code under test. */
const revalidationWireRows: ImportRowInput[] = [
  {
    row: 1,
    type: 'expense',
    date: '2026-08-01',
    amount: '4.50',
    wallet: 'Cash',
    source_wallet: null,
    destination_wallet: null,
    category: 'Food',
    description: 'Coffee',
    latitude: null,
    longitude: null,
  },
  {
    row: 2,
    type: 'expense',
    date: '2026-08-04',
    amount: '20.00',
    wallet: 'Unknown',
    source_wallet: null,
    destination_wallet: null,
    category: null,
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 3,
    type: 'expense',
    date: '2026-08-04',
    amount: '20.00',
    wallet: 'unknown',
    source_wallet: null,
    destination_wallet: null,
    category: null,
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 4,
    type: 'transfer',
    date: '2026-08-05',
    amount: '30.00',
    wallet: null,
    source_wallet: 'Unknown',
    destination_wallet: 'Cash',
    category: null,
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 5,
    type: 'transfer',
    date: '2026-08-06',
    amount: '30.00',
    wallet: null,
    source_wallet: 'Cash',
    destination_wallet: 'unknown',
    category: null,
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 6,
    type: 'expense',
    date: '2026-08-07',
    amount: '9.00',
    wallet: 'Unknown',
    source_wallet: null,
    destination_wallet: null,
    category: 'Nope',
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 7,
    type: 'income',
    date: '2026-08-08',
    amount: '50.00',
    wallet: 'Bank',
    source_wallet: null,
    destination_wallet: null,
    category: 'Food',
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 8,
    type: 'expense',
    date: '2026-08-01',
    amount: '4.50',
    wallet: 'Cash',
    source_wallet: null,
    destination_wallet: null,
    category: 'Food',
    description: 'Coffee',
    latitude: null,
    longitude: null,
  },
]

/** The Category Revalidation fixture: problem rows referencing a missing
 * Category under two spellings (rows 2 and 3 are the in-file Duplicate
 * pair), a problem row about a missing Wallet instead, plus ready and
 * duplicate rows that must stay untouched. */
const categoryRevalidationPreview: ImportPreview = {
  rows: [
    {
      row: 1,
      status: 'ok',
      type: 'income',
      date: '2026-08-02',
      amount: '100.00',
      wallet: 'Bank',
      source_wallet: null,
      destination_wallet: null,
      category: 'Salary',
      description: null,
      latitude: null,
      longitude: null,
      error: null,
    },
    {
      row: 2,
      status: 'error',
      type: 'expense',
      date: '2026-08-04',
      amount: '20.00',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'Bills',
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown expense category 'Bills'",
    },
    {
      row: 3,
      status: 'error',
      type: 'expense',
      date: '2026-08-04',
      amount: '20.00',
      wallet: 'Cash',
      source_wallet: null,
      destination_wallet: null,
      category: 'bills',
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown expense category 'bills'",
    },
    {
      row: 4,
      status: 'error',
      type: 'expense',
      date: '2026-08-05',
      amount: '12.00',
      wallet: 'Unknown',
      source_wallet: null,
      destination_wallet: null,
      category: null,
      description: null,
      latitude: null,
      longitude: null,
      error: "Unknown wallet 'Unknown'",
    },
    {
      row: 5,
      status: 'duplicate',
      type: 'income',
      date: '2026-08-02',
      amount: '100.00',
      wallet: 'Bank',
      source_wallet: null,
      destination_wallet: null,
      category: 'Salary',
      description: null,
      latitude: null,
      longitude: null,
      error: null,
    },
  ],
  ok_count: 1,
  error_count: 3,
  duplicate_count: 1,
}

/** The category revalidation fixture's rows as the wire's ImportRowInput
 * literals — the batch call must carry every draft row, independently
 * written. */
const categoryRevalidationWireRows: ImportRowInput[] = [
  {
    row: 1,
    type: 'income',
    date: '2026-08-02',
    amount: '100.00',
    wallet: 'Bank',
    source_wallet: null,
    destination_wallet: null,
    category: 'Salary',
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 2,
    type: 'expense',
    date: '2026-08-04',
    amount: '20.00',
    wallet: 'Cash',
    source_wallet: null,
    destination_wallet: null,
    category: 'Bills',
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 3,
    type: 'expense',
    date: '2026-08-04',
    amount: '20.00',
    wallet: 'Cash',
    source_wallet: null,
    destination_wallet: null,
    category: 'bills',
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 4,
    type: 'expense',
    date: '2026-08-05',
    amount: '12.00',
    wallet: 'Unknown',
    source_wallet: null,
    destination_wallet: null,
    category: null,
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 5,
    type: 'income',
    date: '2026-08-02',
    amount: '100.00',
    wallet: 'Bank',
    source_wallet: null,
    destination_wallet: null,
    category: 'Salary',
    description: null,
    latitude: null,
    longitude: null,
  },
]

/** The Wallet created inline in the Revalidation tests: the name every
 * matching problem row was waiting for. */
const unknownWallet: Wallet = {
  id: 8,
  name: 'Unknown',
  type: 'checking',
  balance: '0.00',
  frozen: false,
  created_at: '2026-08-05T00:00:00Z',
}

/** The expense Category created inline in the Category Revalidation test. */
const billsExpenseCategory: Category = {
  id: 6,
  name: 'Bills',
  type: 'expense',
  icon: null,
  color: '#ef4444',
  created_at: '2026-08-05T00:00:00Z',
}

/** The draft itself lives in the app shell (issue #43); this harness opens
 * a fresh draft locally and hands the controller to the screen, so the tests
 * keep driving the real state transitions. The entity lists live in the
 * Transactions screen; the harness mirrors them in local state so an
 * inline-created entity (issue #77) flows back into the dropdowns exactly
 * the way the real host updates its list state. */
function Harness({
  initialWallets = wallets,
  initialCategories = categories,
}: {
  initialWallets?: Wallet[]
  initialCategories?: Category[]
}) {
  const controller = useImportDraft()
  const [walletList, setWalletList] = useState<Wallet[]>(initialWallets)
  const [categoryList, setCategoryList] = useState<Category[]>(initialCategories)
  useEffect(() => {
    controller.open()
    // The harness mounts once; opening on mount is the whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (controller.draft === null) return null
  return (
    <ImportScreen
      controller={controller}
      wallets={walletList}
      categories={categoryList}
      onWalletCreated={(wallet) => setWalletList((current) => [...current, wallet])}
      onCategoryCreated={(category) =>
        setCategoryList((current) => [...current, category])
      }
      onDone={vi.fn()}
    />
  )
}

/** Picks a file, reads it, and lands on the preview phase. */
async function openPreview(
  previewOverride: ImportPreview = preview,
  harnessProps: { initialWallets?: Wallet[]; initialCategories?: Category[] } = {},
) {
  previewImportMock.mockResolvedValue(previewOverride)
  const view = render(<Harness {...harnessProps} />)
  const file = new File(['rows'], 'rows.csv', { type: 'text/csv' })
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
  fireEvent.change(input!, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Read and validate' }))
  return view
}

beforeEach(() => {
  localStorage.setItem('budjetame.token', 'budjetame.token')
  confirmImportMock.mockReset()
  previewImportMock.mockReset()
  validateImportRowMock.mockReset()
  revalidateImportRowsMock.mockReset()
  createWalletMock.mockReset()
  createCategoryMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ImportScreen sticky confirm bar (issue #42)', () => {
  it('pins the counts and the Import button in a sticky bar while "Pick another file" stays above the list', async () => {
    await openPreview()

    const importButton = await screen.findByRole('button', { name: 'Import 2 rows' })
    const bar = importButton.closest('.sticky')
    expect(bar).not.toBeNull()
    expect(within(bar as HTMLElement).getByText('2 ready')).toBeInTheDocument()
    expect(within(bar as HTMLElement).getByText('1 duplicate')).toBeInTheDocument()
    expect(within(bar as HTMLElement).getByText('1 problem')).toBeInTheDocument()
    expect(bar).not.toHaveTextContent('Pick another file')

    // "Pick another file" sits above the row list, the bar below it: the
    // list is the only scrolling region between them.
    const pickAgain = screen.getByRole('button', { name: 'Pick another file' })
    const list = screen.getByRole('list')
    expect(
      pickAgain.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      list.compareDocumentPosition(bar as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('reflects the selection in the bar: disabled "Nothing to import" at zero, "Import N rows" otherwise', async () => {
    await openPreview()

    // Every ready row starts selected.
    const importButton = await screen.findByRole('button', { name: 'Import 2 rows' })
    expect(importButton).toBeEnabled()

    // Deselecting both ready rows drops the selection to zero: the bar
    // disables the button, and tapping it imports nothing.
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    const nothing = screen.getByRole('button', { name: 'Nothing to import' })
    expect(nothing).toBeDisabled()
    fireEvent.click(nothing)
    expect(confirmImportMock).not.toHaveBeenCalled()

    // Re-selecting one row re-enables the button with the matching count.
    fireEvent.click(checkboxes[0])
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeEnabled()
  })

  it('imports exactly the selected rows when the bar button is tapped', async () => {
    confirmImportMock.mockResolvedValue([importedTransaction])
    await openPreview()

    await screen.findByRole('button', { name: 'Import 2 rows' })
    // Keep only the second ready row selected.
    fireEvent.click(screen.getAllByRole('checkbox')[0])

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 row' }))

    await waitFor(() =>
      expect(confirmImportMock).toHaveBeenCalledWith('budjetame.token', [
        {
          row: 2,
          type: 'income',
          date: '2026-08-02',
          amount: '100.00',
          wallet: 'Bank',
          source_wallet: null,
          destination_wallet: null,
          category: 'Salary',
          description: null,
          latitude: null,
          longitude: null,
        },
      ]),
    )
    expect(await screen.findByText(/Imported 1 transaction/)).toBeInTheDocument()
  })
})

/** The fixture's rows 1-3 as the wire's ImportRowInput literals — the worked
 * example the validate/confirm calls must match, written independently of
 * the code under test. */
const wireRows: ImportRowInput[] = [
  {
    row: 1,
    type: 'expense',
    date: '2026-08-01',
    amount: '4.50',
    wallet: 'Cash',
    source_wallet: null,
    destination_wallet: null,
    category: 'Food',
    description: 'Coffee',
    latitude: null,
    longitude: null,
  },
  {
    row: 2,
    type: 'income',
    date: '2026-08-02',
    amount: '100.00',
    wallet: 'Bank',
    source_wallet: null,
    destination_wallet: null,
    category: 'Salary',
    description: null,
    latitude: null,
    longitude: null,
  },
  {
    row: 3,
    type: 'expense',
    date: '2026-08-01',
    amount: '4.50',
    wallet: 'Cash',
    source_wallet: null,
    destination_wallet: null,
    category: 'Food',
    description: 'Coffee',
    latitude: null,
    longitude: null,
  },
]

describe('ImportScreen row editor (issue #46)', () => {
  /** Lands on the preview and opens the editor for the given row. */
  const openEditor = async (rowNumber: number) => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })
    fireEvent.click(screen.getByRole('button', { name: `Edit row ${rowNumber}` }))
    const dialog = await screen.findByRole('dialog', { name: `Edit row ${rowNumber}` })
    return { dialog }
  }

  it('opens prefilled for ready, duplicate, and problem rows; backdrop, Escape, and Cancel close without changing the row', async () => {
    // Problem row.
    const problem = await openEditor(4)
    expect(within(problem.dialog).getByLabelText('Wallet')).toHaveValue('Unknown')
    expect(within(problem.dialog).getByLabelText('Amount (€)')).toHaveValue(12)
    expect(within(problem.dialog).getByLabelText('Date')).toHaveValue('2026-08-03')
    expect(within(problem.dialog).queryByLabelText('From')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(validateImportRowMock).not.toHaveBeenCalled()
    expect(screen.getByText("Unknown wallet 'Unknown'")).toBeInTheDocument()

    // Ready row, closed via the backdrop.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const ready = await screen.findByRole('dialog', { name: 'Edit row 1' })
    expect(within(ready).getByLabelText('Wallet')).toHaveValue('Cash')
    expect(within(ready).getByLabelText('Category')).toHaveValue('Food')
    expect(within(ready).getByLabelText('Description')).toHaveValue('Coffee')
    fireEvent.click(ready.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(validateImportRowMock).not.toHaveBeenCalled()

    // Duplicate row, closed via Cancel.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 3' }))
    const duplicate = await screen.findByRole('dialog', { name: 'Edit row 3' })
    expect(within(duplicate).getByLabelText('Wallet')).toHaveValue('Cash')
    expect(within(duplicate).getByLabelText('Amount (€)')).toHaveValue(4.5)
    fireEvent.click(within(duplicate).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(validateImportRowMock).not.toHaveBeenCalled()

    // Every row is still there with its original status.
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Edit row 3' })).toHaveTextContent('Duplicate')
  })

  it('lets the Type switch and adapts the fields: wallet+category for expense/income, source/destination and no category for transfers', async () => {
    const { dialog } = await openEditor(1)
    expect(within(dialog).getByLabelText('Wallet')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Category')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('From')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }))
    expect(within(dialog).queryByLabelText('Wallet')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Category')).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('From')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('To')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Transfers never carry a category.'),
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    expect(within(dialog).getByLabelText('Wallet')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Category')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('From')).not.toBeInTheDocument()
  })

  it('saves through the re-validation endpoint, flips a fixed problem row to Ready inline, and auto-selects it', async () => {
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    const { dialog } = await openEditor(4)

    fireEvent.change(within(dialog).getByLabelText('Wallet'), { target: { value: 'Cash' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(validateImportRowMock).toHaveBeenCalledWith(
        'budjetame.token',
        {
          row: 4,
          type: 'expense',
          date: '2026-08-03',
          amount: '12.00',
          wallet: 'Cash',
          source_wallet: null,
          destination_wallet: null,
          category: null,
          description: null,
          latitude: null,
          longitude: null,
        },
        wireRows,
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select row 4' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Import 3 rows' })).toBeInTheDocument()
    expect(screen.queryByText("Unknown wallet 'Unknown'")).not.toBeInTheDocument()
  })

  it('deselects a selected row that stops being ready', async () => {
    validateImportRowMock.mockResolvedValue({ status: 'duplicate', error: null })
    const { dialog } = await openEditor(1)

    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Latte' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(validateImportRowMock).toHaveBeenCalledWith(
        'budjetame.token',
        { ...wireRows[0], description: 'Latte' },
        [],
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select row 1' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Edit row 1' })).toHaveTextContent('Duplicate')
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeInTheDocument()
  })

  it('keeps a problem row\'s error message until the problem is actually fixed', async () => {
    validateImportRowMock.mockResolvedValue({
      status: 'error',
      error: "Unknown wallet 'Cash'",
    })
    const { dialog } = await openEditor(4)

    fireEvent.change(within(dialog).getByLabelText('Wallet'), { target: { value: 'Cash' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText("Unknown wallet 'Cash'")).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select row 4' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import 2 rows' })).toBeInTheDocument()

    // Reopening keeps the last saved edit; a real fix flips it to Ready.
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const reopened = await screen.findByRole('dialog', { name: 'Edit row 4' })
    expect(within(reopened).getByLabelText('Wallet')).toHaveValue('Cash')
    fireEvent.change(within(reopened).getByLabelText('Wallet'), { target: { value: 'Bank' } })
    fireEvent.click(within(reopened).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select row 4' })).toBeChecked()
    expect(screen.queryByText("Unknown wallet 'Cash'")).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 3 rows' })).toBeInTheDocument()
  })

  it('confirms the edited values, not the file\'s originals', async () => {
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    confirmImportMock.mockResolvedValue([importedTransaction])
    const { dialog } = await openEditor(4)

    fireEvent.change(within(dialog).getByLabelText('Wallet'), { target: { value: 'Cash' } })
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Lunch' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Import 3 rows' }))

    await waitFor(() =>
      expect(confirmImportMock).toHaveBeenCalledWith(
        'budjetame.token',
        expect.arrayContaining([
          {
            row: 4,
            type: 'expense',
            date: '2026-08-03',
            amount: '12.00',
            wallet: 'Cash',
            source_wallet: null,
            destination_wallet: null,
            category: null,
            description: 'Lunch',
            latitude: null,
            longitude: null,
          },
        ]),
      ),
    )
  })

  it('sends the earlier draft rows — with their edits applied — as the in-file Duplicate context', async () => {
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })

    // Edit row 3's description first, so its edited value becomes part of
    // the context for later rows.
    const first = await openEditor(3)
    fireEvent.change(within(first.dialog).getByLabelText('Description'), {
      target: { value: 'Espresso' },
    })
    fireEvent.click(within(first.dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const second = await screen.findByRole('dialog', { name: 'Edit row 4' })
    fireEvent.click(within(second).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(validateImportRowMock).toHaveBeenLastCalledWith(
        'budjetame.token',
        {
          row: 4,
          type: 'expense',
          date: '2026-08-03',
          amount: '12.00',
          wallet: 'Unknown',
          source_wallet: null,
          destination_wallet: null,
          category: null,
          description: null,
          latitude: null,
          longitude: null,
        },
        expect.arrayContaining([
          expect.objectContaining({ row: 3, description: 'Espresso' }),
        ]),
      ),
    )
  })
})

describe('ImportScreen preview description title', () => {
  it('shows the Description as its own line under date · type, and hides the line when blank', async () => {
    await openPreview()

    const withDescription = await screen.findByRole('button', { name: 'Edit row 1' })
    const titleLines = (node: HTMLElement) =>
      Array.from(node.querySelectorAll('span')).filter(
        (span) =>
          span.className.includes('text-sm') && span.className.includes('font-medium'),
      )
    expect(titleLines(withDescription).map((span) => span.textContent)).toEqual([
      '2026-08-01 · Expense',
      'Coffee',
    ])
    // The gray meta line no longer repeats the Description.
    expect(withDescription).toHaveTextContent('Cash · Food')

    // A blank Description renders no empty bold line: only the date · type
    // line keeps the medium weight.
    const withoutDescription = await screen.findByRole('button', { name: 'Edit row 2' })
    expect(titleLines(withoutDescription).map((span) => span.textContent)).toEqual([
      '2026-08-02 · Income',
    ])
  })
})

describe('ImportScreen row editor entity selects and inline creation (issue #77)', () => {
  /** The row editor's Wallet select options, in order. */
  const walletOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Wallet').querySelectorAll('option'),
    ).map((option) => option.textContent)

  /** The row editor's Category select options, in order. */
  const categoryOptions = (dialog: HTMLElement) =>
    Array.from(
      within(dialog).getByLabelText('Category').querySelectorAll('option'),
    ).map((option) => option.textContent)

  /** A Transfer's From/To select options, in order. */
  const transferOptions = (dialog: HTMLElement, label: string) =>
    Array.from(
      within(dialog).getByLabelText(label).querySelectorAll('option'),
    ).map((option) => option.textContent)

  it('lists the existing Wallets and Categories with the sentinel last; Transfer rows get From/To with all four Wallet types and no Category field', async () => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    // Expense row: only the three non-Contact active Wallets; the Category
    // select offers None and the expense Categories; the sentinel is last.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 1' })
    expect(walletOptions(dialog)).toEqual(['Cash', 'Bank', '＋ Add wallet…'])
    expect(categoryOptions(dialog)).toEqual(['None', '🍔 Food', '＋ Add category…'])

    // Income row: the same Wallets, the income Categories.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 2' }))
    const incomeDialog = await screen.findByRole('dialog', { name: 'Edit row 2' })
    expect(walletOptions(incomeDialog)).toEqual(['Cash', 'Bank', '＋ Add wallet…'])
    expect(categoryOptions(incomeDialog)).toEqual(['None', 'Salary', '＋ Add category…'])

    // Transfer: From/To offer all four types including Contact, and no
    // Category field at all.
    fireEvent.click(within(incomeDialog).getByRole('button', { name: 'Transfer' }))
    expect(transferOptions(incomeDialog, 'From')).toEqual([
      'Cash',
      'Bank',
      'Marco',
      '＋ Add wallet…',
    ])
    expect(transferOptions(incomeDialog, 'To')).toEqual([
      'Cash',
      'Bank',
      'Marco',
      '＋ Add wallet…',
    ])
    expect(within(incomeDialog).queryByLabelText('Category')).not.toBeInTheDocument()
    expect(
      within(incomeDialog).getByText('Transfers never carry a category.'),
    ).toBeInTheDocument()
  })

  it('keeps a missing name as the current value in a "doesn\'t exist yet" option', async () => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    // Row 4's file name 'Unknown' matches no Wallet: it stays the current
    // value, shown as a "doesn't exist yet" option.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(walletSelect).toHaveValue('Unknown')
    expect(
      within(walletSelect as HTMLElement).getByText("Unknown (doesn't exist yet)"),
    ).toBeInTheDocument()

    // A row's name that resolves only under the other type is missing too:
    // switching the Expense row to Income leaves 'Food' (an expense
    // Category) unresolved.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const row1 = await screen.findByRole('dialog', { name: 'Edit row 1' })
    fireEvent.click(within(row1).getByRole('button', { name: 'Income' }))
    const categorySelect = within(row1).getByLabelText('Category')
    expect(categorySelect).toHaveValue('Food')
    expect(
      within(categorySelect as HTMLElement).getByText("Food (doesn't exist yet)"),
    ).toBeInTheDocument()
  })

  it('a file name that differs only in case shows the resolved entity as the current selection', async () => {
    await openPreview({
      rows: [
        {
          row: 1,
          status: 'ok',
          type: 'expense',
          date: '2026-08-01',
          amount: '4.50',
          wallet: 'cash',
          source_wallet: null,
          destination_wallet: null,
          category: 'food',
          description: null,
          latitude: null,
          longitude: null,
          error: null,
        },
      ],
      ok_count: 1,
      error_count: 0,
      duplicate_count: 0,
    })
    await screen.findByRole('button', { name: 'Import 1 row' })

    // The lowercase file names resolve case-insensitively, exactly like the
    // import's validation: the selects show the canonical names selected.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 1' })
    expect(within(dialog).getByLabelText('Wallet')).toHaveValue('Cash')
    expect(within(dialog).getByLabelText('Category')).toHaveValue('Food')
    expect(within(dialog).queryByText(/doesn't exist yet/)).not.toBeInTheDocument()
  })

  it('picking the Wallet sentinel on an Expense/Income row opens the New wallet modal prefilled with the missing name, restricted to the three types, while the dropdown keeps its value', async () => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    expect(walletSelect).toHaveValue('Unknown')

    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // Prefilled with the file's missing name; the Type selector offers only
    // Checking, Credit Card, and Cash (never Contact).
    expect(within(walletDialog).getByLabelText('Name')).toHaveValue('Unknown')
    expect(
      Array.from(
        within(walletDialog).getByLabelText('Type').querySelectorAll('option'),
      ).map((option) => option.textContent),
    ).toEqual(['Checking', 'Credit Card', 'Cash'])
    expect(
      within(walletDialog).getByText('Checking, Credit Card, Cash · fixed for this form'),
    ).toBeInTheDocument()
    // The editor behind keeps its state; nothing was created.
    expect(screen.getByRole('dialog', { name: 'Edit row 4' })).toBeInTheDocument()
    expect(walletSelect).toHaveValue('Unknown')
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(12)
    expect(createWalletMock).not.toHaveBeenCalled()
  })

  it('picking the sentinel from a Transfer From/To opens the modal with all four Wallet types', async () => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 1' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer' }))

    fireEvent.change(within(dialog).getByLabelText('From'), {
      target: { value: SENTINEL_VALUE },
    })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // No restriction: Contact is offered, and no "fixed for this form" note.
    expect(
      Array.from(
        within(walletDialog).getByLabelText('Type').querySelectorAll('option'),
      ).map((option) => option.textContent),
    ).toEqual(['Checking', 'Credit Card', 'Cash', 'Contact'])
    expect(within(walletDialog).queryByText('fixed for this form')).not.toBeInTheDocument()
  })

  it('picking the Category sentinel opens the New category modal locked to the row\'s type, prefilled with the missing name; the lock follows the row\'s live Type', async () => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 1' })
    // Switch to Income: the file's 'Food' is an expense Category, so it is
    // missing here — and the modal must open locked to Income.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    const categorySelect = within(dialog).getByLabelText('Category')
    expect(categorySelect).toHaveValue('Food')

    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    expect(within(categoryDialog).getByLabelText('Name')).toHaveValue('Food')
    expect(within(categoryDialog).queryByLabelText('Type')).not.toBeInTheDocument()
    expect(
      within(categoryDialog).getByText('Income · fixed for this form'),
    ).toBeInTheDocument()

    // Cancel, switch the row back to Expense, and re-pick: the lock is the
    // row's live type, and a resolving name prefills nothing.
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Expense' }))
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const expenseDialog = await screen.findByRole('dialog', { name: 'New category' })
    expect(
      within(expenseDialog).getByText('Expense · fixed for this form'),
    ).toBeInTheDocument()
    expect(within(expenseDialog).getByLabelText('Name')).toHaveValue('')
  })

  it('the full Wallet flow — sentinel, create, auto-select, save — creates the Wallet for real and carries its name', async () => {
    createWalletMock.mockResolvedValue(revolutWallet)
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // The missing name is prefilled; the user corrects it and creates.
    expect(within(walletDialog).getByLabelText('Name')).toHaveValue('Unknown')
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('budjetame.token', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '',
      }),
    )
    // Only the inner modal closes; the editor and its draft survive.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'Edit row 4' })).toBeInTheDocument()
    // The new Wallet is auto-selected and offered in the dropdown.
    await waitFor(() => expect(walletSelect).toHaveValue('Revolut'))
    expect(walletOptions(dialog)).toEqual(['Cash', 'Bank', 'Revolut', '＋ Add wallet…'])
    // The rest of the draft is untouched.
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(12)
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-08-03')
    expect(within(dialog).getByLabelText('Category')).toHaveValue('')
    expect(validateImportRowMock).not.toHaveBeenCalled()

    // Saving the row sends the new Wallet's name through re-validation.
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(validateImportRowMock).toHaveBeenCalledWith(
        'budjetame.token',
        expect.objectContaining({ row: 4, wallet: 'Revolut' }),
        wireRows,
      ),
    )
  })

  it('the full Category flow — sentinel, create, auto-select, save — creates the Category with the locked type and carries its name', async () => {
    createCategoryMock.mockResolvedValue(billsCategory)
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 1' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Income' }))
    const categorySelect = within(dialog).getByLabelText('Category')
    fireEvent.change(categorySelect, { target: { value: SENTINEL_VALUE } })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    // The missing name is prefilled; the user corrects it and creates.
    expect(within(categoryDialog).getByLabelText('Name')).toHaveValue('Food')
    fireEvent.change(within(categoryDialog).getByLabelText('Name'), {
      target: { value: 'Bills' },
    })
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    await waitFor(() =>
      expect(createCategoryMock).toHaveBeenCalledWith('budjetame.token', {
        name: 'Bills',
        type: 'income',
        icon: '',
        color: '#ef4444',
      }),
    )
    // Only the inner modal closes; the editor survives with its draft.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'Edit row 1' })).toBeInTheDocument()
    await waitFor(() => expect(categorySelect).toHaveValue('Bills'))
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(4.5)
    expect(validateImportRowMock).not.toHaveBeenCalled()

    // Saving the row sends the new Category's name, with the row's type.
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(validateImportRowMock).toHaveBeenCalledWith(
        'budjetame.token',
        expect.objectContaining({ row: 1, type: 'income', category: 'Bills' }),
        [],
      ),
    )
  })

  it('Cancel, backdrop, and Escape close only the create modal and leave the editor exactly as it was', async () => {
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    const openWalletModal = async () => {
      fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
      return await screen.findByRole('dialog', { name: 'New wallet' })
    }
    const editorSurvives = () => {
      expect(screen.getByRole('dialog', { name: 'Edit row 4' })).toBeInTheDocument()
      expect(walletSelect).toHaveValue('Unknown')
      expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(12)
    }

    // Cancel closes only the inner modal.
    let walletDialog = await openWalletModal()
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    editorSurvives()

    // Backdrop tap closes only the inner modal.
    walletDialog = await openWalletModal()
    fireEvent.click(walletDialog.previousElementSibling as Element)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    editorSurvives()

    // One Escape closes only the topmost modal; a second closes the editor.
    walletDialog = await openWalletModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    editorSurvives()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createWalletMock).not.toHaveBeenCalled()
    expect(validateImportRowMock).not.toHaveBeenCalled()
  })

  it('a name that case-insensitively matches an existing Wallet surfaces the validation error inside the modal, with nothing selected', async () => {
    createWalletMock.mockRejectedValue(new ApiError('Conflict', 409))
    await openPreview()
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    const walletSelect = within(dialog).getByLabelText('Wallet')
    fireEvent.change(walletSelect, { target: { value: SENTINEL_VALUE } })
    const walletDialog = await screen.findByRole('dialog', { name: 'New wallet' })
    // 'cash' collides with the existing 'Cash', case-insensitively.
    fireEvent.change(within(walletDialog).getByLabelText('Name'), {
      target: { value: 'cash' },
    })
    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Create wallet' }))

    expect(
      await within(walletDialog).findByText('A wallet with this name already exists.'),
    ).toBeInTheDocument()
    // The modal stays open and nothing is selected; the editor is intact.
    expect(screen.getByRole('dialog', { name: 'New wallet' })).toBeInTheDocument()
    expect(walletSelect).toHaveValue('Unknown')
    expect(within(dialog).getByLabelText('Amount (€)')).toHaveValue(12)

    fireEvent.click(within(walletDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog', { name: 'Edit row 4' })).toBeInTheDocument()
    expect(validateImportRowMock).not.toHaveBeenCalled()
  })

  it('keeps the sentinels when no Wallets or Categories exist yet', async () => {
    await openPreview(preview, { initialWallets: [], initialCategories: [] })
    await screen.findByRole('button', { name: 'Import 2 rows' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 4' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit row 4' })
    expect(walletOptions(dialog)).toEqual(["Unknown (doesn't exist yet)", '＋ Add wallet…'])
    expect(categoryOptions(dialog)).toEqual(['None', '＋ Add category…'])
  })
})

describe('ImportScreen inline-creation Revalidation (issue #78)', () => {
  /** Opens the editor on a row and picks its Wallet sentinel: the New
   * wallet modal opens on top, prefilled with the field's missing name. */
  const openWalletCreate = async (rowNumber: number) => {
    fireEvent.click(screen.getByRole('button', { name: `Edit row ${rowNumber}` }))
    const editor = await screen.findByRole('dialog', { name: `Edit row ${rowNumber}` })
    fireEvent.change(within(editor).getByLabelText('Wallet'), {
      target: { value: SENTINEL_VALUE },
    })
    const create = await screen.findByRole('dialog', { name: 'New wallet' })
    return { editor, create }
  }

  it('creating a Wallet flips every problem row referencing its name — Ready auto-selected, Duplicate unselectable, remaining Problems narrowed, unrelated rows untouched — and refreshes the sticky bar', async () => {
    createWalletMock.mockResolvedValue(unknownWallet)
    revalidateImportRowsMock.mockResolvedValue([
      { row: 2, status: 'ok', error: null },
      { row: 3, status: 'duplicate', error: null },
      { row: 4, status: 'ok', error: null },
      { row: 5, status: 'ok', error: null },
      { row: 6, status: 'error', error: "Unknown expense category 'Nope'" },
    ])
    await openPreview(revalidationPreview)
    await screen.findByRole('button', { name: 'Import 1 row' })

    const { create } = await openWalletCreate(2)
    // The missing name is prefilled; submitting it unchanged creates the
    // Wallet the rows were waiting for.
    expect(within(create).getByLabelText('Name')).toHaveValue('Unknown')
    fireEvent.click(within(create).getByRole('button', { name: 'Create wallet' }))

    // One batch call: every draft row travels as the in-file Duplicate
    // context, and only the problem rows referencing 'Unknown' — through
    // Wallet, From, or To, case-insensitively — are the targets. Row 7's
    // problem is unrelated and stays out.
    await waitFor(() =>
      expect(revalidateImportRowsMock).toHaveBeenCalledWith(
        'budjetame.token',
        revalidationWireRows,
        [2, 3, 4, 5, 6],
      ),
    )

    // The flips: the Ready rows auto-select, the file's case-variant twin
    // becomes an unselectable Duplicate, the row with a remaining Category
    // problem narrows its message, and the unrelated row keeps its own
    // exactly. The untouched ready row stays selected and the untouched
    // duplicate stays unselectable.
    await screen.findByText('4 ready')
    expect(screen.getByRole('checkbox', { name: 'Select row 2' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select row 4' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select row 5' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select row 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit row 3' })).toHaveTextContent(
      'Duplicate',
    )
    expect(
      within(screen.getByRole('button', { name: 'Edit row 3' })).getByText(
        /Already in the database or repeated in this file/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit row 6' })).toHaveTextContent(
      'Problem',
    )
    expect(screen.getByText("Unknown expense category 'Nope'")).toBeInTheDocument()
    expect(screen.queryByText("Unknown wallet 'Unknown'")).not.toBeInTheDocument()
    expect(screen.queryByText("Unknown wallet 'unknown'")).not.toBeInTheDocument()
    expect(
      screen.getByText("Category 'Food' is an expense category, not income"),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select row 1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select row 8' })).toBeDisabled()
    // The sticky bar's counts refreshed with the flips.
    expect(screen.getByText('2 duplicates')).toBeInTheDocument()
    expect(screen.getByText('2 problems')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 4 rows' })).toBeInTheDocument()
  })

  it('flips the row being edited too, even when the editor is then cancelled without saving', async () => {
    createWalletMock.mockResolvedValue(unknownWallet)
    revalidateImportRowsMock.mockResolvedValue([{ row: 2, status: 'ok', error: null }])
    await openPreview(revalidationPreview)
    await screen.findByRole('button', { name: 'Import 1 row' })

    const { editor, create } = await openWalletCreate(2)
    fireEvent.click(within(create).getByRole('button', { name: 'Create wallet' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )

    // The editor's field selected the new Wallet, but the draft row behind
    // still stores the missing name: the batch targets the stored values.
    await waitFor(() =>
      expect(within(editor).getByLabelText('Wallet')).toHaveValue('Unknown'),
    )
    // Cancel without saving.
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The row behind has flipped to Ready and is auto-selected.
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Select row 2' })).toBeChecked(),
    )
    expect(screen.getByRole('button', { name: 'Edit row 2' })).toHaveTextContent('Ready')
    expect(screen.getByText('2 ready')).toBeInTheDocument()
    expect(validateImportRowMock).not.toHaveBeenCalled()
  })

  it('creating a Category does the same for every problem row whose Category field references it', async () => {
    createCategoryMock.mockResolvedValue(billsExpenseCategory)
    revalidateImportRowsMock.mockResolvedValue([
      { row: 2, status: 'ok', error: null },
      { row: 3, status: 'duplicate', error: null },
    ])
    await openPreview(categoryRevalidationPreview)
    await screen.findByRole('button', { name: 'Import 1 row' })

    fireEvent.click(screen.getByRole('button', { name: 'Edit row 2' }))
    const editor = await screen.findByRole('dialog', { name: 'Edit row 2' })
    fireEvent.change(within(editor).getByLabelText('Category'), {
      target: { value: SENTINEL_VALUE },
    })
    const categoryDialog = await screen.findByRole('dialog', { name: 'New category' })
    // Prefilled with the missing name, locked to the row's type.
    expect(within(categoryDialog).getByLabelText('Name')).toHaveValue('Bills')
    expect(
      within(categoryDialog).getByText('Expense · fixed for this form'),
    ).toBeInTheDocument()
    fireEvent.click(within(categoryDialog).getByRole('button', { name: 'Create category' }))

    await waitFor(() =>
      expect(revalidateImportRowsMock).toHaveBeenCalledWith(
        'budjetame.token',
        categoryRevalidationWireRows,
        [2, 3],
      ),
    )
    // The first row flips Ready and auto-selects; its case-variant twin
    // becomes an unselectable Duplicate; the Wallet problem row keeps its
    // exact message. The editor auto-selected the new Category.
    await screen.findByText('2 ready')
    expect(screen.getByRole('checkbox', { name: 'Select row 2' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select row 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit row 3' })).toHaveTextContent(
      'Duplicate',
    )
    expect(screen.getByText("Unknown wallet 'Unknown'")).toBeInTheDocument()
    expect(screen.getByText('2 duplicates')).toBeInTheDocument()
    expect(screen.getByText('1 problem')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(editor).getByLabelText('Category')).toHaveValue('Bills'),
    )
  })

  it('leaves hand-verified rows alone: their edits, statuses, and selections survive the flips', async () => {
    validateImportRowMock.mockResolvedValue({ status: 'ok', error: null })
    createWalletMock.mockResolvedValue(unknownWallet)
    revalidateImportRowsMock.mockResolvedValue([
      { row: 2, status: 'ok', error: null },
      { row: 3, status: 'duplicate', error: null },
      { row: 4, status: 'ok', error: null },
      { row: 5, status: 'ok', error: null },
    ])
    await openPreview(revalidationPreview)
    await screen.findByRole('button', { name: 'Import 1 row' })

    // Hand-verify row 6: fix both problems and save.
    fireEvent.click(screen.getByRole('button', { name: 'Edit row 6' }))
    const editor = await screen.findByRole('dialog', { name: 'Edit row 6' })
    fireEvent.change(within(editor).getByLabelText('Wallet'), {
      target: { value: 'Cash' },
    })
    fireEvent.change(within(editor).getByLabelText('Category'), {
      target: { value: 'Food' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Select row 6' })).toBeChecked()

    // Create the Wallet from row 2's editor: the hand-verified row 6 is no
    // longer a problem and no longer references the name, so it is neither
    // targeted nor touched — its edited values travel only as context.
    const { create } = await openWalletCreate(2)
    fireEvent.click(within(create).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() =>
      expect(revalidateImportRowsMock).toHaveBeenCalledWith(
        'budjetame.token',
        revalidationWireRows.map((row) =>
          row.row === 6 ? { ...row, wallet: 'Cash', category: 'Food' } : row,
        ),
        [2, 3, 4, 5],
      ),
    )
    await screen.findByText('5 ready')
    expect(screen.getByRole('checkbox', { name: 'Select row 6' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Edit row 6' })).toHaveTextContent('Ready')
  })

  it('makes no batch call when no problem row references the created name', async () => {
    createWalletMock.mockResolvedValue(revolutWallet)
    await openPreview(revalidationPreview)
    await screen.findByRole('button', { name: 'Import 1 row' })

    const { editor, create } = await openWalletCreate(2)
    // The user types a name no row references.
    fireEvent.change(within(create).getByLabelText('Name'), {
      target: { value: 'Revolut' },
    })
    fireEvent.click(within(create).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New wallet' })).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(within(editor).getByLabelText('Wallet')).toHaveValue('Revolut'),
    )
    expect(revalidateImportRowsMock).not.toHaveBeenCalled()
    // The preview's board is unchanged.
    expect(screen.getByText('1 ready')).toBeInTheDocument()
    expect(screen.getByText('1 duplicate')).toBeInTheDocument()
    expect(screen.getByText('6 problems')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 row' })).toBeInTheDocument()
  })
})
