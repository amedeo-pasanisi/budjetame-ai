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
    fetchAssistantSettings: vi.fn(),
    saveAssistantSettings: vi.fn(),
    removeAssistantSettings: vi.fn(),
  }
})

import { fetchAssistantSettings } from './api'

const fetchAssistantSettingsMock = vi.mocked(fetchAssistantSettings)

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
  fetchAssistantSettingsMock.mockReset().mockResolvedValue({
    configured: false,
    provider: null,
    model: null,
    last4: null,
  })
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

  it('renders the Assistant Settings block in English under locale en', async () => {
    fetchAssistantSettingsMock.mockResolvedValue({
      configured: true,
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      last4: 'ab12',
    })
    renderModal('en')

    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Provider' })).toBeInTheDocument()
    expect(screen.getByLabelText('Assistant Key')).toBeInTheDocument()
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(
      await screen.findByText('Configured: Anthropic / claude-opus-5-5, key ends in ab12'),
    ).toBeInTheDocument()
  })

  it('renders the Assistant Settings block in Italian under locale it', async () => {
    fetchAssistantSettingsMock.mockResolvedValue({
      configured: true,
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      last4: 'ab12',
    })
    renderModal('it')

    expect(screen.getByText('Assistente')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Provider' })).toBeInTheDocument()
    expect(screen.getByLabelText("Chiave dell'Assistente")).toBeInTheDocument()
    expect(screen.getByLabelText('Modello')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salva' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rimuovi' })).toBeInTheDocument()
    expect(
      await screen.findByText('Configurato: Google Gemini / gemini-4-hydrogen, la chiave termina con ab12'),
    ).toBeInTheDocument()
  })

  it('renders "Non configurato" in Italian without settings', async () => {
    renderModal('it')

    expect(await screen.findByText('Non configurato')).toBeInTheDocument()
  })

  it('falls back to English for untranslated keys', () => {
    renderModal('de')

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument()
  })
})
