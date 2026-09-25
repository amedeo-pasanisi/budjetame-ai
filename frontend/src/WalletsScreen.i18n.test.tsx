/** i18n Wallets screen tests (issue #117): screen title, type/section
 * labels, and buttons render in Italian under Locale `it`, English under
 * `en`, with English as the fallback for any untranslated key. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { WalletsScreen } from './WalletsScreen'
import { renderWithIntl } from './test/renderWithIntl'
import type { Wallet } from './api'

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
        ? error.status === 409 ? conflict : fallback
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

import { fetchWallets } from './api'

const fetchWalletsMock = vi.mocked(fetchWallets)

const createdAt = '2026-08-01T10:00:00Z'

const wallets: Wallet[] = [
  { id: 1, name: 'Anna', type: 'contact', balance: '50.00', frozen: false, created_at: createdAt },
  { id: 2, name: 'Intesa', type: 'checking', balance: '1200.00', frozen: false, created_at: createdAt },
  { id: 3, name: 'Amex', type: 'credit_card', balance: '-250.00', frozen: false, created_at: createdAt },
  { id: 4, name: 'Contanti', type: 'cash', balance: '80.00', frozen: false, created_at: createdAt },
]

beforeEach(() => {
  fetchWalletsMock.mockResolvedValue(wallets)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('WalletsScreen i18n (issue #117)', () => {
  it('renders English strings under locale en', async () => {
    renderWithIntl(<WalletsScreen />, { locale: 'en' })

    expect(screen.getByText('Wallets')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New wallet' })).toBeInTheDocument()
    // Section headers
    expect(await screen.findByText('Contacts')).toBeInTheDocument()
    expect(screen.getByText('Checking Accounts')).toBeInTheDocument()
    expect(screen.getByText('Credit Cards')).toBeInTheDocument()
    // Cash appears twice: section header and the cash wallet's type subtitle
    expect(screen.getAllByText('Cash').length).toBeGreaterThanOrEqual(2)
    // Type subtitle
    expect(screen.getByText('Contact')).toBeInTheDocument()
  })

  it('renders Italian strings under locale it', async () => {
    renderWithIntl(<WalletsScreen />, { locale: 'it' })

    expect(screen.getByText('Portafogli')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nuovo portafoglio' })).toBeInTheDocument()
    // Section headers in Italian
    expect(await screen.findByText('Contatti')).toBeInTheDocument()
    expect(screen.getByText('Conti correnti')).toBeInTheDocument()
    expect(screen.getByText('Carte di credito')).toBeInTheDocument()
    // Contanti appears twice: section header and the cash wallet's subtitle
    expect(screen.getAllByText('Contanti').length).toBeGreaterThanOrEqual(2)
    // Type subtitle in Italian
    expect(screen.getByText('Contatto')).toBeInTheDocument()
  })

  it('renders Italian frozen wallets header under locale it', async () => {
    const withFrozen: Wallet[] = [
      ...wallets,
      { id: 5, name: 'Vecchio', type: 'checking', balance: '0.00', frozen: true, created_at: createdAt },
    ]
    fetchWalletsMock.mockResolvedValue(withFrozen)
    renderWithIntl(<WalletsScreen />, { locale: 'it' })

    expect(
      await screen.findByRole('button', { name: 'Portafogli congelati (1)' }),
    ).toBeInTheDocument()
  })

  it('falls back to English for untranslated keys', async () => {
    renderWithIntl(<WalletsScreen />, { locale: 'de' })

    expect(screen.getByText('Wallets')).toBeInTheDocument()
    expect(await screen.findByText('Contacts')).toBeInTheDocument()
  })
})
