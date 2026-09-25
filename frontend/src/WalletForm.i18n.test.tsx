/** i18n Wallet form tests (issue #117): the Wallets screen's key form —
 * labels, buttons, and validation errors render in Italian under Locale
 * `it`, English under `en`, with English as the fallback. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { WalletForm } from './WalletForm'
import { renderWithIntl } from './test/renderWithIntl'

vi.mock('./api', () => ({
  TOKEN_KEY: 'budjetame.token',
  ApiError: class ApiError extends Error {},
  apiErrorMessage: (_error: unknown, conflict: string, fallback: string) =>
    conflict || fallback,
  formatEuros: (value: string) => `€${value}`,
  createWallet: vi.fn(),
  renameWallet: vi.fn(),
  freezeWallet: vi.fn(),
  unfreezeWallet: vi.fn(),
}))

function renderForm(locale: string) {
  return renderWithIntl(
    <WalletForm
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
    { locale },
  )
}

describe('WalletForm i18n (issue #117)', () => {
  it('renders English labels under locale en', () => {
    renderForm('en')

    expect(screen.getByText('New wallet')).toBeInTheDocument()
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Opening balance (optional)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create wallet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders Italian labels under locale it', () => {
    renderForm('it')

    expect(screen.getByText('Nuovo portafoglio')).toBeInTheDocument()
    expect(screen.getByText('Nome')).toBeInTheDocument()
    expect(screen.getByText('Tipo')).toBeInTheDocument()
    expect(screen.getByText('Saldo iniziale (facoltativo)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crea portafoglio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument()
  })

  it('renders the Italian type options under locale it', () => {
    renderForm('it')

    expect(screen.getByRole('option', { name: 'Conto corrente' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Carta di credito' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Contanti' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Contatto' })).toBeInTheDocument()
  })

  it('renders Italian validation errors under locale it', () => {
    renderForm('it')

    const name = screen.getByLabelText('Nome') as HTMLInputElement
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crea portafoglio' }))

    expect(screen.getByText('Inserisci un nome')).toBeInTheDocument()
  })

  it('falls back to English for untranslated keys', () => {
    renderForm('de')

    expect(screen.getByText('New wallet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create wallet' })).toBeInTheDocument()
  })
})
