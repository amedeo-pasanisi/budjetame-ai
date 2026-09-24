/** The settings modal (issue #84): shows the signed-in Account, closes
 * cleanly, hosts the Export all backup action, and hosts the Delete account
 * action with its own confirm step. Also hosts the Restore from backup flow
 * (issue #115). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
  }
})

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
  render(
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

/** Helper to select a file via the hidden input. */
async function selectFile(file: File) {
  const input = screen.getByLabelText('Restore from backup…').querySelector('input[type="file"]')
  if (!input) throw new Error('File input not found')
  fireEvent.change(input, { target: { files: [file] } })
}

describe('SettingsModal (issue #84)', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, 'test-token')
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

    const picker = screen.getByRole('combobox') as HTMLSelectElement
    expect(picker).toBeInTheDocument()
    expect(picker.value).toBe('en')
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Italiano' })).toBeInTheDocument()
  })

  it('reports the picked language on change', () => {
    const onChangeLanguage = vi.fn()
    renderModal({ language: 'en', onChangeLanguage })

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'it' } })

    expect(onChangeLanguage).toHaveBeenCalledWith('it')
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