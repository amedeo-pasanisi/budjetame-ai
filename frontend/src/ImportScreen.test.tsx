/** Import preview sticky confirm bar (issue #42): while the row list is long,
 * a footer pinned to the bottom keeps the ready/duplicate/problem counts and
 * the Import button visible; the button reflects the selection ("Nothing to
 * import" disabled at zero, "Import N rows" otherwise) and imports exactly
 * the selected rows; "Pick another file" stays above the list, out of the
 * bar. The API client is mocked; the screen is driven like a user would
 * (pick a file, read, toggle, confirm). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { ImportScreen } from './ImportScreen'
import { useImportDraft } from './importDraft'
import type { ImportPreview, Transaction } from './api'

vi.mock('./api', () => ({
  TOKEN_KEY: 'budjetame.token',
  formatEuros: (value: string) => `€${value}`,
  previewImport: vi.fn(),
  confirmImport: vi.fn(),
}))

import { confirmImport, previewImport } from './api'

const previewImportMock = vi.mocked(previewImport)
const confirmImportMock = vi.mocked(confirmImport)

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
