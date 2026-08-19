/** Wallets screen type sections with signed balances (#47): the list renders
 * four sections in a fixed order — Contacts, Checking Accounts, Credit Cards,
 * Cash — each sorted A→Z case-insensitively, empty sections hidden, and
 * every balance signed in the transaction-amount convention (+€ / -€, €0.00
 * unsigned). Rows keep their existing look; create, rename, and freeze now
 * live in a modal with the New wallet button in the page header
 * (issue #49), behavior unchanged. The API client is mocked; the real display
 * helpers stay live. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { WalletsScreen } from './WalletsScreen'
import type { Wallet } from './api'

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

import { createWallet, fetchWallets, freezeWallet, renameWallet, unfreezeWallet } from './api'

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
    const contactRows = within(contacts).getAllByRole('button').map((b) => b.textContent)
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
    const contactRows = within(contacts).getAllByRole('button').map((b) => b.textContent)
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
      within(region).getAllByRole('button').map((b) => b.textContent)

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
    const contactRows = within(screen.getByRole('region', { name: 'Contacts' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
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
    fireEvent.click(within(contacts).getByRole('button', { name: /Marco/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'alberto' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(renameWalletMock).toHaveBeenCalledWith('', 4, 'alberto'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const contactRows = within(screen.getByRole('region', { name: 'Contacts' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(contactRows[0]).toContain('alberto')
    expect(contactRows[1]).toContain('anna')
    expect(contactRows).toHaveLength(4)
  })

  it('the edit modal fixes the Type, hides the opening balance, and shows the rename-only form', async () => {
    render(<WalletsScreen />)

    const contacts = await screen.findByRole('region', { name: 'Contacts' })
    fireEvent.click(within(contacts).getByRole('button', { name: /Marco/ }))
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
    fireEvent.click(within(contacts).getByRole('button', { name: /Leo/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit wallet' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Freeze wallet' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap again to confirm freeze' }))

    await waitFor(() => expect(freezeWalletMock).toHaveBeenCalledWith('', 6))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const contactRows = within(screen.getByRole('region', { name: 'Contacts' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(contactRows.some((row) => row?.includes('Leo'))).toBe(false)
    expect(contactRows).toHaveLength(3)
    // The frozen footer row appears with the count (issue #48).
    expect(screen.getByRole('button', { name: /Frozen wallets \(1\)/ })).toBeInTheDocument()
  })
})

describe('WalletsScreen frozen wallets (issue #48)', () => {
  const frozenWallet: Wallet = {
    id: 7,
    name: 'Old Card',
    type: 'credit_card',
    balance: '0.00',
    frozen: true,
    created_at: createdAt,
  }
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
    expect(screen.getByRole('button', { name: /Old Card/ }).textContent).toMatch(/€0\.00$/)

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    expect(screen.queryByText('Old Card')).not.toBeInTheDocument()
  })

  it('one tap on a frozen row unfreezes it: it lands in its type section at its sorted position and the footer row disappears', async () => {
    unfreezeWalletMock.mockResolvedValue({ ...frozenWallet, frozen: false })
    fetchWalletsMock.mockResolvedValue([...wallets, frozenWallet])
    render(<WalletsScreen />)
    await screen.findByRole('region', { name: 'Contacts' })

    fireEvent.click(screen.getByRole('button', { name: /Frozen wallets \(1\)/ }))
    fireEvent.click(screen.getByRole('button', { name: /Old Card/ }))

    await waitFor(() => expect(unfreezeWalletMock).toHaveBeenCalledWith('', 7))
    const cards = within(screen.getByRole('region', { name: 'Credit Cards' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
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
    fireEvent.click(screen.getByRole('button', { name: /Drawer/ }))

    await waitFor(() => expect(unfreezeWalletMock).toHaveBeenCalledWith('', 8))
    expect(screen.getByRole('region', { name: 'Cash' })).toBeInTheDocument()
    const cashRows = within(screen.getByRole('region', { name: 'Cash' })).getAllByRole('button')
    expect(cashRows).toHaveLength(1)
    expect(cashRows[0].textContent).toContain('Drawer')
  })
})
