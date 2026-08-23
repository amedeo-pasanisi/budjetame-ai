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
 * The API client is mocked; the screen is driven like a user would (pick a
 * file, read, toggle, edit a row, confirm). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { ImportScreen } from './ImportScreen'
import { useImportDraft } from './importDraft'
import type { ImportPreview, ImportRowInput, Transaction } from './api'

vi.mock('./api', () => ({
  TOKEN_KEY: 'budjetame.token',
  formatEuros: (value: string) => `€${value}`,
  previewImport: vi.fn(),
  confirmImport: vi.fn(),
  validateImportRow: vi.fn(),
  revalidateImportRows: vi.fn(),
}))

import { confirmImport, previewImport, revalidateImportRows, validateImportRow } from './api'

const previewImportMock = vi.mocked(previewImport)
const confirmImportMock = vi.mocked(confirmImport)
const validateImportRowMock = vi.mocked(validateImportRow)
const revalidateImportRowsMock = vi.mocked(revalidateImportRows)

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

/** The draft itself lives in the app shell (issue #43); this harness opens
 * a fresh draft locally and hands the controller to the screen, so the tests
 * keep driving the real state transitions. */
function Harness() {
  const controller = useImportDraft()
  useEffect(() => {
    controller.open()
    // The harness mounts once; opening on mount is the whole point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (controller.draft === null) return null
  return <ImportScreen controller={controller} onDone={vi.fn()} />
}

/** Picks a file, reads it, and lands on the preview phase. */
async function openPreview() {
  previewImportMock.mockResolvedValue(preview)
  const view = render(<Harness />)
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
