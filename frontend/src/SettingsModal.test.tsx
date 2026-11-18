/** The settings modal (issue #84): shows the signed-in Account, closes
 * cleanly, hosts the Export all backup action, and hosts the Delete account
 * action with its own confirm step. Also hosts the Restore from backup flow
 * (issue #115). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { renderWithIntl } from './test/renderWithIntl'

import { TOKEN_KEY } from './api'
import { SettingsModal } from './SettingsModal'

// Mock the entire ./api module so exportBackup and restoreBackup are spies
// that can be configured per-test. The actual TOKEN_KEY is kept for localStorage.
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

import { fetchAssistantSettings, removeAssistantSettings, saveAssistantSettings } from './api'

const fetchAssistantSettingsMock = vi.mocked(fetchAssistantSettings)
const saveAssistantSettingsMock = vi.mocked(saveAssistantSettings)
const removeAssistantSettingsMock = vi.mocked(removeAssistantSettings)

const NOT_CONFIGURED = { configured: false, provider: null, model: null, last4: null }

const renderModal = (
  overrides: Partial<{
    email: string
    language: string
    onChangeLanguage: (language: 'en' | 'it') => void
    onDeleteAccount: () => Promise<void>
    onDeleted: () => void
    onClose: () => void
  }> = {},
) =>
    renderWithIntl(
    <SettingsModal
      email="owner@example.com"
      language="en"
      onChangeLanguage={vi.fn()}
      onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
      onDeleted={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  )

describe('SettingsModal (issue #84)', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, 'test-token')
    fetchAssistantSettingsMock.mockReset().mockResolvedValue(NOT_CONFIGURED)
    saveAssistantSettingsMock.mockReset()
    removeAssistantSettingsMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    localStorage.removeItem(TOKEN_KEY)
  })

  it('shows the signed-in email and the delete action', () => {
    renderModal()

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
  })

  it('shows the language picker with the current locale selected', () => {
    renderModal({ language: 'en' })

    const picker = screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement
    expect(picker).toBeInTheDocument()
    expect(picker.value).toBe('en')
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Italiano' })).toBeInTheDocument()
  })

  it('reports the picked language on change', () => {
    const onChangeLanguage = vi.fn()
    renderModal({ language: 'en', onChangeLanguage })

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'it' } })

    expect(onChangeLanguage).toHaveBeenCalledWith('it')
  })

  // --- Assistant Settings (issue #126, ADR-0035) ---

  describe('Assistant Settings', () => {
    it('shows the block with the three providers, the key and model fields, and "Not configured"', async () => {
      renderModal()

      expect(screen.getByText('Assistant')).toBeInTheDocument()
      const provider = screen.getByRole('combobox', { name: 'Provider' }) as HTMLSelectElement
      expect(provider.value).toBe('anthropic')
      expect(screen.getByRole('option', { name: 'Anthropic' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'OpenRouter' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Google Gemini' })).toBeInTheDocument()
      expect(screen.getByLabelText('Assistant Key')).toHaveAttribute('type', 'password')
      expect(screen.getByLabelText('Model')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()

      expect(await screen.findByText('Not configured')).toBeInTheDocument()
      expect(fetchAssistantSettingsMock).toHaveBeenCalledWith('test-token')
    })

    it('shows the status line and preselects the provider and model when configured', async () => {
      fetchAssistantSettingsMock.mockResolvedValue({
        configured: true,
        provider: 'openrouter',
        model: 'nvidia/nemotron-nano-9b-v2:free',
        last4: 'ab12',
      })
      renderModal()

      expect(
        await screen.findByText('Configured: OpenRouter / nvidia/nemotron-nano-9b-v2:free, key ends in ab12'),
      ).toBeInTheDocument()
      expect((screen.getByRole('combobox', { name: 'Provider' }) as HTMLSelectElement).value).toBe('openrouter')
      expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('nvidia/nemotron-nano-9b-v2:free')
      // The key is write-only: the field never shows the stored one.
      expect((screen.getByLabelText('Assistant Key') as HTMLInputElement).value).toBe('')
    })

    it('saves provider, key and model, then shows the new status and clears the key field', async () => {
      saveAssistantSettingsMock.mockResolvedValue({
        configured: true,
        provider: 'gemini',
        model: 'gemini-4-hydrogen',
        last4: '0001',
      })
      renderModal()
      await screen.findByText('Not configured')

      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'gemini' } })
      fireEvent.change(screen.getByLabelText('Assistant Key'), { target: { value: 'AIzaSy-test-0001' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() =>
        expect(saveAssistantSettingsMock).toHaveBeenCalledWith('test-token', {
          provider: 'gemini',
          key: 'AIzaSy-test-0001',
          model: '',
        }),
      )
      expect(
        await screen.findByText('Configured: Google Gemini / gemini-4-hydrogen, key ends in 0001'),
      ).toBeInTheDocument()
      expect((screen.getByLabelText('Assistant Key') as HTMLInputElement).value).toBe('')
      expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gemini-4-hydrogen')
    })

    it('switching provider resets the typed model, since the provider default takes over', async () => {
      fetchAssistantSettingsMock.mockResolvedValue({
        configured: true,
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        last4: 'ab12',
      })
      renderModal()
      await screen.findByText(/key ends in ab12/)

      fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'openrouter' } })

      expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('')
    })

    it('refuses to save without a key, as a Field Error, and calls nothing', async () => {
      renderModal()
      await screen.findByText('Not configured')

      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Enter the Assistant Key')
      expect(saveAssistantSettingsMock).not.toHaveBeenCalled()
    })

    it('shows an error banner when saving fails', async () => {
      saveAssistantSettingsMock.mockRejectedValue(new Error('boom'))
      renderModal()
      await screen.findByText('Not configured')

      fireEvent.change(screen.getByLabelText('Assistant Key'), { target: { value: 'sk-ant-x' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByText('Could not save the Assistant Settings. Please try again.'),
      ).toBeInTheDocument()
    })

    it('removes the settings and shows "Not configured"', async () => {
      fetchAssistantSettingsMock.mockResolvedValue({
        configured: true,
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        last4: 'ab12',
      })
      renderModal()
      await screen.findByText(/key ends in ab12/)

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

      await waitFor(() => expect(removeAssistantSettingsMock).toHaveBeenCalledWith('test-token'))
      expect(await screen.findByText('Not configured')).toBeInTheDocument()
      expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('')
    })
  })

  it('surfaces the Export all action', () => {
    renderModal()

    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument()
  })

  it('closes from the X button', () => {
    const onClose = vi.fn()
    renderModal({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(onClose).toHaveBeenCalled()
  })

  it('deletes the Account from inside the modal and reports success', async () => {
    const onDeleteAccount = vi.fn().mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderModal({ onDeleteAccount, onDeleted })

    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() => expect(onDeleteAccount).toHaveBeenCalled())
    expect(onDeleted).toHaveBeenCalled()
  })

  it('triggers a backup download when clicking Export all', async () => {
    // Get the mocked exportBackup, configure its resolved value
    const { exportBackup } = await import('./api')
    ;(exportBackup as ReturnType<typeof vi.fn>).mockResolvedValue({
      blob: new Blob(['fake-workbook']),
      filename: 'budjetame-backup-2026-07-15.xlsx',
    })

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = originalCreateElement(tag)
      if (tag === 'a') {
        el.click = clickSpy
      }
      return el
    })

    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Export all' }))

    await waitFor(() => {
      expect(exportBackup).toHaveBeenCalledWith('test-token')
    })

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
  })

  // --- Restore flow (issue #115) ---

  it('shows the Restore from backup… action', () => {
    renderModal()

    expect(screen.getByText('Restore from backup…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose file…' })).toBeInTheDocument()
  })

  it('shows the confirmation step after picking a file', () => {
    renderModal()

    const button = screen.getByRole('button', { name: 'Choose file…' })
    fireEvent.click(button)

    // The file input should be triggered via click
    // We simulate file selection directly
    const input = document.querySelector('input[type="file"]')
    if (!input) throw new Error('File input not found')
    fireEvent.change(input, { target: { files: [new File(['fake-content'], 'backup.xlsx')] } })

    // Now the confirmation step should be shown
    expect(screen.getByRole('heading', { name: 'Restore from backup' })).toBeInTheDocument()
    expect(screen.getByText(/This will replace all/, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export current state first' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore from backup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('calls restoreBackup on confirm and shows success', async () => {
    const { restoreBackup } = await import('./api')
    ;(restoreBackup as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })

    renderModal()

    // Pick a file
    const input = document.querySelector('input[type="file"]')
    if (!input) throw new Error('File input not found')
    fireEvent.change(input, { target: { files: [new File(['fake-content'], 'backup.xlsx')] } })

    // Confirm restore
    fireEvent.click(screen.getByRole('button', { name: 'Restore from backup' }))

    await waitFor(() => {
      expect(restoreBackup).toHaveBeenCalled()
    })

    // Success screen
    expect(screen.getByText('Restore complete')).toBeInTheDocument()
    expect(screen.getByText(/replaced with the backup/)).toBeInTheDocument()
  })

  it('shows warning on origin mismatch and can dismiss', async () => {
    const { restoreBackup } = await import('./api')
    ;(restoreBackup as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      warning: 'Backup was exported from different@email.com',
    })

    renderModal()

    // Pick a file
    const input = document.querySelector('input[type="file"]')
    if (!input) throw new Error('File input not found')
    fireEvent.change(input, { target: { files: [new File(['fake-content'], 'backup.xlsx')] } })

    // Confirm restore
    fireEvent.click(screen.getByRole('button', { name: 'Restore from backup' }))

    await waitFor(() => {
      expect(screen.getByText('Origin mismatch')).toBeInTheDocument()
    })

    // Warning text shown
    expect(screen.getByText(/different@email/)).toBeInTheDocument()

    // Dismiss
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Now the done screen
    expect(screen.getByText('Restore complete')).toBeInTheDocument()
  })

  it('shows error on failed restore', async () => {
    const { restoreBackup } = await import('./api')
    ;(restoreBackup as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Invalid file format'))

    renderModal()

    // Pick a file
    const input = document.querySelector('input[type="file"]')
    if (!input) throw new Error('File input not found')
    fireEvent.change(input, { target: { files: [new File(['bad-content'], 'backup.xlsx')] } })

    // Confirm restore
    fireEvent.click(screen.getByRole('button', { name: 'Restore from backup' }))

    await waitFor(() => {
      expect(screen.getByText('Restore failed')).toBeInTheDocument()
    })

    expect(screen.getByText('Invalid file format')).toBeInTheDocument()
  })
})