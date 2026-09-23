/** Wallets screen type sections with signed balances (#47): the list renders
 * four sections in a fixed order — Contacts, Checking Accounts, Credit Cards,
 * Cash — each sorted A→Z case-insensitively, empty sections hidden, and
 * every balance signed in the transaction-amount convention (+€ / -€, €0.00
 * unsigned). Create, rename, and freeze live in a modal with the New wallet
 * button in the page header (issue #49).
 *
 * Row structure (issue #93): a row is a main tap surface plus sibling
 * trailing buttons — never nested. The tap surface opens the Transactions
 * ledger pre-filtered to that Wallet (the shell's requestLedgerFilter,
 * issue #90); ✎ Edit opens the edit modal, and frozen rows add a one-tap
 * Unfreeze button. The API client is mocked; the real display helpers stay
 * live.
 *
 * The Wallet form inside the modals is submit-and-validate (ADR-0029,
 * issue #107): the Save button is always clickable except while work is in
 * flight, and an invalid draft reveals Field Errors under the wrong fields
 * instead of calling the API. The Opening balance is a tolerant Amount
 * Input — text, both separators, empty stays valid (the Wallet starts at
 * €0). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { WalletsScreen } from './WalletsScreen'
import type { Wallet } from './api'
import { ApiError, createWallet, fetchWallets, freezeWallet, renameWallet, unfreezeWallet } from './api'

vi.mock('./api', async () => {
  // The real display helpers, so the screen exercises the actual formatting
  // (the sign convention is the feature); only the resource calls are mocked.
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
    fetchWallets: vi.fn(),
    createWallet: vi.fn(),
    renameWallet: vi.fn(),
    freezeWallet: vi.fn(),
    unfreezeWallet: vi.fn(),
  }
})

const createdAt = '2026-08-01T10:00:00Z'

// Deliberately unsorted and mixed case: case-insensitive A→Z order is anna,
// Marco, zara (contacts). No cash wallet, so the Cash section stays hidden.
const wallets: Wallet[] = [
  { id: 1, name: 'zara', type: 'contact', balance: '50.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Intesa', type: 'checking', balance: '1200.00', frozen: false, created_at: createdAt },
  { id: 3, name: 'anna', type: 'contact', balance: '-30.00', frozen: false, created_at: createdAt },
  { id: 4, name: 'Marco', type: 'contact', balance: '10.00', frozen: false, created_at: createdAt },
  { id: 5, name: 'Amex', type: 'credit_card', balance: '-250.00', frozen: false, created_at: createdAt },
  { id: 6, name: 'Leo', type: 'contact', balance: '0.00', frozen: false, created_at: createdAt },
]

const fetchWalletsMock = vi.mocked(fetchWallets)
const createWalletMock = vi.mocked(createWallet)
const renameWalletMock = vi.mocked(renameWallet)
const freezeWalletMock = vi.mocked(freezeWallet)
const unfreezeWalletMock = vi.mocked(unfreezeWallet)

/** The row tap surfaces inside one section: each row is a tap surface plus
 * sibling trailing buttons (✎ Edit, and Unfreeze on frozen rows, issue
 * #93), so a plain `getAllByRole('button')` would also pick up the trailing
 * ✎ buttons — told apart by their `Edit …` aria-labels. */
function rowTapButtons(region: HTMLElement): HTMLElement[] {
  return within(region)
    .getAllByRole('button')
    .filter((button) => !(button.getAttribute('aria-label') ?? '').startsWith('Edit '))
}

// Fixtures for the Frozen Wallets list (issue #48): a credit card frozen at
// €0.00, plus a frozen Cash wallet for the hidden-section case.
const frozenWallet: Wallet = {
  id: 7,
  name: 'Old Card',
  type: 'credit_card',
  balance: '0.00',
  frozen: true,
  created_at: createdAt,
}

beforeEach(() => {
  fetchWalletsMock.mockResolvedValue(wallets)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WalletsScreen header (issue #49)', () => {
  it('puts the New wallet button in the header row with the heading, always enabled, and no bottom button', () => {
    render(<WalletsScreen />)

    // Asserted before the list resolves: the button needs nothing from the
    // list, so it is available while loading (issue #49).
    const heading = screen.getByRole('heading', { name: 'Wallets' })
    const newWallet = within(heading.parentElement as HTMLElement).getByRole('button', {
      name: 'New wallet',
    })
    expect(newWallet).not.toBeDisabled()
    // The old bottom button is gone, not duplicated.
    expect(screen.queryByRole('button', { name: '+ New wallet' })).not.toBeInTheDocument()
  })
})

describe('WalletsScreen sections (issue #47)', () => {
  it('groups wallets into sections in the fixed order with plural headers, hiding empty sections', async () => {
    render(<WalletsScreen />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    const contactRows = rowTapButtons(contacts).map((b) => b.textContent)
    expect(contactRows.some((row) => row?.includes('zara'))).toBe(true)
    expect(contactRows.some((row) => row?.includes('Marco'))).toBe(true)

    // Checking Accounts and Credit Cards are present; Cash is hidden because
    // no wallet of that type exists.
    expect(screen.getByRole('region', { name: 'Checking Accounts' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Credit Cards' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Cash' })).not.toBeInTheDocument()

    // Fixed order in the document: Contacts, Checking Accounts, Credit Cards.
    const headings = screen
      .getAllByRole('region')
      .map((region) => within(region).getByRole('heading').textContent)
    expect(headings).toEqual(['Contacts', 'Checking Accounts', 'Credit Cards'])
  })

  it('sorts each section A→Z case-insensitively and keeps the singular type subtitles', async () => {
    render(<WalletsScreen />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    const contactRows = rowTapButtons(contacts).map((b) => b.textContent)
    expect(contactRows[0]).toContain('anna')
    expect(contactRows[1]).toContain('Leo')
    expect(contactRows[2]).toContain('Marco')
    expect(contactRows[3]).toContain('zara')
    // The row look is unchanged: the singular type label is the subtitle.
    expect(contactRows[0]).toContain('Contact')
  })

  it('signs every balance in the transaction-amount convention: +€, -€, and unsigned €0.00', async () => {
    render(<WalletsScreen />)

    const rows = (region: HTMLElement) =>
      rowTapButtons(region).map((b) => b.textContent)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    // A positive Contact balance is "owes me", a negative is "I owe", and a
    // settled contact stays unsigned.
    expect(rows(contacts)[0]).toContain('-€30.00')
    // Settled is neutral: exactly "Contact€0.00", with no sign before the €.
    expect(rows(contacts)[1]).toMatch(/Contact€0\.00$/)
    expect(rows(contacts)[2]).toContain('+€10.00')
    expect(rows(contacts)[3]).toContain('+€50.00')

    // The sign applies to every wallet in every section, not only Contacts:
    // a positive Checking balance and a negative Credit Card balance.
    expect(
      rows(screen.getByRole('region', { name: 'Checking Accounts' }))[0],
    ).toContain('+€1200.00')
    expect(
      rows(screen.getByRole('region', { name: 'Credit Cards' }))[0],
    ).toContain('-€250.00')
  })

  it('keeps the empty state when there are no wallets at all', async () => {
    fetchWalletsMock.mockResolvedValue([])
    render(<WalletsScreen />)

    expect(
      await screen.findByText('No wallets yet. Add your first one to start tracking.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('a created wallet lands at the sorted position of its section, which appears if it was empty', async () => {
    createWalletMock.mockResolvedValue({
      id: 9,
      name: 'alice',
      type: 'contact',
      balance: '0.00',
      frozen: false,
      created_at: createdAt,
    })
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    const dialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'alice' } })
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'contact' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create wallet' }))

    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'alice',
        type: 'contact',
        openingBalance: '',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const contactRows = rowTapButtons(screen.getByRole('region', { name: 'Contacts' })).map(
      (b) => b.textContent,
    )
    expect(contactRows).toHaveLength(5)
    expect(contactRows[0]).toContain('alice')
  })

  it('the create modal selects a Type with the four options and only offers Opening balance while creating', async () => {
    createWalletMock.mockResolvedValue({
      id: 9,
      name: 'alice',
      type: 'checking',
      balance: '10.00',
      frozen: false,
      created_at: createdAt,
    })
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    const dialog = await screen.findByRole('dialog', { name: 'New wallet' })
    const typeSelect = within(dialog).getByLabelText('Type')
    expect(typeSelect).toHaveValue('checking')
    expect(
      Array.from(typeSelect.querySelectorAll('option')).map((option) => option.textContent),
    ).toEqual(['Checking', 'Credit Card', 'Cash', 'Contact'])
    // The helper text is the create-only default: money you already have.
    expect(within(dialog).getByLabelText('Opening balance (optional)')).not.toBeDisabled()
    expect(
      within(dialog).getByText('Money you already have. Defaults to €0.00.'),
    ).toBeInTheDocument()

    // A Contact wallet starts at €0: the opening balance is disabled and the
    // helper text explains why (unchanged behavior, now in the modal).
    fireEvent.change(typeSelect, { target: { value: 'contact' } })
    expect(within(dialog).getByLabelText('Opening balance (optional)')).toBeDisabled()
    expect(
      within(dialog).getByText('Contact wallets start at €0 — money moves only through transfers.'),
    ).toBeInTheDocument()
  })

  it('backdrop tap, Escape, and Cancel all close the create modal without creating', async () => {
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    const dialog = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.click(dialog.previousElementSibling as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    const third = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.click(within(third).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(createWalletMock).not.toHaveBeenCalled()
  })

  it('a renamed wallet moves to its new sorted position within its section', async () => {
    renameWalletMock.mockResolvedValue({ ...wallets[3], name: 'alberto' })
    render(<WalletsScreen />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: 'Edit Marco' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'alberto' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(renameWalletMock).toHaveBeenCalledWith('', 4, 'alberto'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const contactRows = rowTapButtons(screen.getByRole('region', { name: 'Contacts' })).map(
      (b) => b.textContent,
    )
    expect(contactRows[0]).toContain('alberto')
    expect(contactRows[1]).toContain('anna')
    expect(contactRows).toHaveLength(4)
  })

  it('the edit modal fixes the Type, hides the opening balance, and shows the rename-only form', async () => {
    render(<WalletsScreen />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: 'Edit Marco' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })

    // The Name is prefilled and the Type is fixed: a note, no selector.
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Marco')
    expect(within(dialog).queryByLabelText('Type')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Contact · type cannot be changed')).toBeInTheDocument()
    // Opening balance belongs to creation only.
    expect(within(dialog).queryByLabelText('Opening balance (optional)')).not.toBeInTheDocument()
  })

  it('freezing a settled contact still works: tap-again confirm in the edit modal, wallet moves to the frozen list', async () => {
    freezeWalletMock.mockResolvedValue(undefined)
    render(<WalletsScreen />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: 'Edit Leo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Freeze wallet' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm freeze' }))

    await waitFor(() => expect(freezeWalletMock).toHaveBeenCalledWith('', 6))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const contactRows = rowTapButtons(screen.getByRole('region', { name: 'Contacts' })).map(
      (b) => b.textContent,
    )
    expect(contactRows.some((row) => row?.includes('Leo'))).toBe(false)
    expect(contactRows).toHaveLength(3)
    // The frozen footer row appears with the count (issue #48).
    expect(screen.getByRole('button', { name: /Frozen wallets \(1\)/ })).toBeInTheDocument()
  })
})

describe('WalletsScreen frozen wallets (issue #48)', () => {
  const frozenCash: Wallet = {
    id: 8,
    name: 'Drawer',
    type: 'cash',
    balance: '0.00',
    frozen: true,
    created_at: createdAt,
  }

  it('keeps frozen wallets out of the type sections and shows a collapsed Frozen wallets row with the count', async () => {
    fetchWalletsMock.mockResolvedValue([...wallets, frozenWallet])
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    expect(
      within(screen.getByRole('region', { name: 'Credit Cards' })).queryByRole(
        'button',
        { name: /Old Card/ },
      ),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Frozen wallets \(1\)/ })).toBeInTheDocument()
  })

  it('expands and collapses the frozen list in place; rows read "Type · Frozen" with unsigned €0.00', async () => {
    fetchWalletsMock.mockResolvedValue([...wallets, frozenWallet])
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    expect(screen.queryByText('Old Card')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    expect(screen.getByText('Old Card')).toBeInTheDocument()
    expect(screen.getByText('Credit Card · Frozen')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Old Card/ }).textContent,
    ).toMatch(/€0\.00$/)

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    expect(screen.queryByText('Old Card')).not.toBeInTheDocument()
  })

  it('unfreezes from the edit modal: lands in its type section at its sorted position and the footer row disappears', async () => {
    unfreezeWalletMock.mockResolvedValue({ ...frozenWallet, frozen: false })
    fetchWalletsMock.mockResolvedValue([...wallets, frozenWallet])
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old Card' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unfreeze wallet' }))

    await waitFor(() => expect(unfreezeWalletMock).toHaveBeenCalledWith('', 7))
    const cards = rowTapButtons(screen.getByRole('region', { name: 'Credit Cards' })).map(
      (b) => b.textContent,
    )
    expect(cards[0]).toContain('Amex')
    expect(cards[1]).toContain('Old Card')
    expect(screen.queryByRole('button', { name: /Frozen wallets/ })).not.toBeInTheDocument()
  })

  it('unfreezing a wallet whose type section is hidden creates the section', async () => {
    unfreezeWalletMock.mockResolvedValue({ ...frozenCash, frozen: false })
    fetchWalletsMock.mockResolvedValue([...wallets, frozenCash])
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })
    expect(screen.queryByRole('region', { name: 'Cash' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Drawer' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unfreeze wallet' }))

    await waitFor(() => expect(unfreezeWalletMock).toHaveBeenCalledWith('', 8))
    expect(screen.getByRole('region', { name: 'Cash' })).toBeInTheDocument()
    const cashRows = rowTapButtons(screen.getByRole('region', { name: 'Cash' }))
    expect(cashRows).toHaveLength(1)
    expect(cashRows[0].textContent).toContain('Drawer')
  })
})

describe('WalletsScreen row taps open the ledger (issue #93)', () => {
  it('an active row tap requests the ledger jump for that wallet and opens no modal', async () => {
    const requestLedgerFilter = vi.fn()
    render(<WalletsScreen requestLedgerFilter={requestLedgerFilter} />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: /^anna/ }))

    expect(requestLedgerFilter).toHaveBeenCalledTimes(1)
    expect(requestLedgerFilter).toHaveBeenCalledWith({ kind: 'wallet', id: 3 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a frozen row tap requests the ledger jump too — it neither unfreezes nor edits', async () => {
    const requestLedgerFilter = vi.fn()
    fetchWalletsMock.mockResolvedValue([...wallets, frozenWallet])
    render(<WalletsScreen requestLedgerFilter={requestLedgerFilter} />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Old Card/ }))

    expect(requestLedgerFilter).toHaveBeenCalledTimes(1)
    expect(requestLedgerFilter).toHaveBeenCalledWith({ kind: 'wallet', id: 7 })
    expect(unfreezeWalletMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('WalletsScreen trailing row buttons (issue #93)', () => {
  it('✎ opens the prefilled edit modal on an active row, without jumping', async () => {
    const requestLedgerFilter = vi.fn()
    render(<WalletsScreen requestLedgerFilter={requestLedgerFilter} />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: 'Edit anna' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })

    expect(within(dialog).getByLabelText('Name')).toHaveValue('anna')
    expect(requestLedgerFilter).not.toHaveBeenCalled()
  })

  it('✎ opens the edit modal on a frozen row too (renaming a frozen wallet works), without jumping or unfreezing', async () => {
    const requestLedgerFilter = vi.fn()
    fetchWalletsMock.mockResolvedValue([...wallets, frozenWallet])
    render(<WalletsScreen requestLedgerFilter={requestLedgerFilter} />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old Card' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })

    // A frozen wallet is read-only: the name renders as text, no input,
    // and only the Unfreeze action is offered.
    expect(within(dialog).getByText('Old Card')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Name')).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Unfreeze wallet' }),
    ).toBeInTheDocument()
    expect(requestLedgerFilter).not.toHaveBeenCalled()
    expect(unfreezeWalletMock).not.toHaveBeenCalled()
  })
})

describe('Wallet form submit-and-validate (ADR-0029, issue #107)', () => {
  const createButton = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Create wallet' })
  const nameInput = (dialog: HTMLElement) => within(dialog).getByLabelText('Name')
  const balanceInput = (dialog: HTMLElement) =>
    within(dialog).getByLabelText('Opening balance (optional)')

  const openCreateDialog = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    return await screen.findByRole('dialog', { name: 'New wallet' })
  }

  it('keeps Create clickable on an invalid draft, reveals "Enter a name" under the field, and calls no API', async () => {
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    const dialog = await openCreateDialog()
    // Save is never disabled for validation (ADR-0029): an empty Name must
    // be discoverable by trying to save.
    expect(createButton(dialog)).toBeEnabled()
    fireEvent.click(createButton(dialog))

    expect(screen.getByText('Enter a name')).toBeInTheDocument()
    expect(createWalletMock).not.toHaveBeenCalled()
    // The Name field carries the error via the aria wiring (ADR-0029): a
    // screen reader reads the message with its field.
    expect(nameInput(dialog)).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput(dialog)).toHaveAttribute('aria-describedby', 'name-error')
    expect(document.getElementById('name-error')).toHaveTextContent('Enter a name')
    // The browser's own validation voice is off: Field Errors are the only
    // ones.
    expect(document.querySelector('form')).toHaveAttribute('novalidate')
  })

  it('keeps the Name error while typing the fix, clearing only on the next Save', async () => {
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    const dialog = await openCreateDialog()
    fireEvent.click(createButton(dialog))
    expect(screen.getByText('Enter a name')).toBeInTheDocument()

    // Fixing the field changes nothing on screen (ADR-0029): errors
    // refresh only on the next Save attempt.
    fireEvent.change(nameInput(dialog), { target: { value: 'Revolut' } })
    expect(screen.getByText('Enter a name')).toBeInTheDocument()

    fireEvent.click(createButton(dialog))
    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // The successful save leaves no error text anywhere.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('the Opening balance is a tolerant text Amount Input: a malformed value reveals the parser\'s error and submits nothing', async () => {
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    const dialog = await openCreateDialog()
    const balance = balanceInput(dialog) as HTMLInputElement
    // The Amount Input contract (ADR-0029): a text field — not the
    // browser-owned type="number" that swallowed dots in comma-locales.
    expect(balance).toHaveAttribute('type', 'text')
    expect(balance).toHaveAttribute('inputmode', 'decimal')
    // The number input's min/step are gone with it.
    expect(balance).not.toHaveAttribute('min')
    expect(balance).not.toHaveAttribute('step')

    fireEvent.change(nameInput(dialog), { target: { value: 'Revolut' } })
    fireEvent.change(balance, { target: { value: '12.34.56' } })
    fireEvent.click(createButton(dialog))

    expect(
      screen.getByText(
        "That doesn't look like an amount — use digits and one . or , for decimals",
      ),
    ).toBeInTheDocument()
    expect(balance).toHaveAttribute('aria-invalid', 'true')
    expect(balance).toHaveAttribute('aria-describedby', 'openingBalance-error')
    expect(document.getElementById('openingBalance-error')).toHaveTextContent(
      "That doesn't look like an amount — use digits and one . or , for decimals",
    )
    expect(createWalletMock).not.toHaveBeenCalled()
  })

  it('a non-positive Opening balance reveals the positive-amount error', async () => {
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    const dialog = await openCreateDialog()
    fireEvent.change(nameInput(dialog), { target: { value: 'Revolut' } })
    fireEvent.change(balanceInput(dialog), { target: { value: '0' } })
    fireEvent.click(createButton(dialog))

    expect(screen.getByText('Amount must be a positive number')).toBeInTheDocument()
    expect(createWalletMock).not.toHaveBeenCalled()
  })

  it('saves a tolerant Opening balance with the canonical parsed value (17,5 → 17.50, 1.000,45 → 1000.45)', async () => {
    createWalletMock.mockResolvedValue({
      id: 9,
      name: 'Revolut',
      type: 'checking',
      balance: '17.50',
      frozen: false,
      created_at: createdAt,
    })
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    // Comma decimals (17,5) parse and reach the API as canonical cents.
    const dialog = await openCreateDialog()
    fireEvent.change(nameInput(dialog), { target: { value: 'Revolut' } })
    fireEvent.change(balanceInput(dialog), { target: { value: '17,5' } })
    fireEvent.click(createButton(dialog))
    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '17.50',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Italian-style grouping + comma decimals (1.000,45) parse to 1000.45.
    fireEvent.click(screen.getByRole('button', { name: 'New wallet' }))
    const second = await screen.findByRole('dialog', { name: 'New wallet' })
    fireEvent.change(nameInput(second), { target: { value: 'Revolut' } })
    fireEvent.change(balanceInput(second), { target: { value: '1.000,45' } })
    fireEvent.click(createButton(second))
    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '1000.45',
      }),
    )
  })

  it('an empty Opening balance stays valid: the new Wallet starts at €0', async () => {
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    const dialog = await openCreateDialog()
    fireEvent.change(nameInput(dialog), { target: { value: 'Revolut' } })
    // No balance touched: the form sends '' and the API client emits the
    // "0.00" balance — the Wallet starts at €0.
    fireEvent.click(createButton(dialog))
    await waitFor(() =>
      expect(createWalletMock).toHaveBeenCalledWith('', {
        name: 'Revolut',
        type: 'checking',
        openingBalance: '',
      }),
    )
    // The empty balance raised no Field Error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clearing the Name while editing reveals the same error and rename is not called', async () => {
    render(<WalletsScreen />)
    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: 'Edit Marco' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '' } })
    fireEvent.click(save)

    expect(screen.getByText('Enter a name')).toBeInTheDocument()
    expect(renameWalletMock).not.toHaveBeenCalled()
    expect(save).toBeEnabled()
  })

  it('a 409 duplicate-name rejection keeps the form-level banner and never becomes a Field Error', async () => {
    createWalletMock.mockRejectedValue(new ApiError('Conflict', 409))
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    const dialog = await openCreateDialog()
    fireEvent.change(nameInput(dialog), { target: { value: 'Intesa' } })
    fireEvent.click(createButton(dialog))

    expect(
      await within(dialog).findByText('A wallet with this name already exists.'),
    ).toBeInTheDocument()
    // Server rejections keep the form-level banner (ADR-0029); Field Errors
    // (role=alert) never appear — the two error kinds never mix.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
