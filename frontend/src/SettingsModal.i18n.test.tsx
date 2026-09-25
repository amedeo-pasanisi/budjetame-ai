/** i18n Settings modal tests (issue #117): section titles, descriptions,
 * and buttons render in Italian under Locale `it`, English under `en`,
 * with English as the fallback for any untranslated key. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { TOKEN_KEY } from './api'
import { SettingsModal } from './SettingsModal'
import { renderWithIntl } from './test/renderWithIntl'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    exportBackup: vi.fn(),
    restoreBackup: vi.fn(),
  }
})

const renderModal = (locale: string, language = 'en') =>
  renderWithIntl(
    <SettingsModal
      email="owner@example.com"
      language={language}
      onChangeLanguage={vi.fn()}
      onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
      onDeleted={vi.fn()}
      onClose={vi.fn()}
    />,
    { locale },
  )

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, 'test-token')
})

afterEach(() => {
  localStorage.removeItem(TOKEN_KEY)
})

describe('SettingsModal i18n (issue #117)', () => {
  it('renders English strings under locale en', () => {
    renderModal('en')

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    // "Export all" appears twice: section heading and the action button
    expect(screen.getAllByText('Export all').length).toBe(2)
    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument()
    expect(screen.getByText('Restore from backup…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose file…' })).toBeInTheDocument()
    // "Delete account" appears twice: section heading and the button
    expect(screen.getAllByText('Delete account').length).toBe(2)
  })

  it('renders Italian strings under locale it', () => {
    renderModal('it')

    expect(screen.getByRole('heading', { name: 'Impostazioni' })).toBeInTheDocument()
    expect(screen.getByText('Lingua')).toBeInTheDocument()
    // "Esporta tutto" appears twice: section heading and the action button
    expect(screen.getAllByText('Esporta tutto').length).toBe(2)
    expect(screen.getByRole('button', { name: 'Esporta tutto' })).toBeInTheDocument()
    expect(screen.getByText('Ripristina da backup…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scegli file…' })).toBeInTheDocument()
    // "Elimina account" appears twice: section heading and the button
    expect(screen.getAllByText('Elimina account').length).toBe(2)
  })

  it('renders Italian restore-flow strings under locale it', () => {
    renderModal('it')

    fireEvent.click(screen.getByRole('button', { name: 'Scegli file…' }))
    const input = document.querySelector('input[type="file"]')
    if (!input) throw new Error('File input not found')
    fireEvent.change(input, {
      target: { files: [new File(['fake-content'], 'backup.xlsx')] },
    })

    expect(
      screen.getByRole('heading', { name: 'Ripristino da backup' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Prima esporta lo stato attuale' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Ripristina da backup' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeInTheDocument()
  })

  it('falls back to English for untranslated keys', () => {
    renderModal('de')

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument()
  })
})
