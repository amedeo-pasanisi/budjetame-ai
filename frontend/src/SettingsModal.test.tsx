/** The settings modal (issue #84): shows the signed-in Account, closes
 * cleanly, and hosts the Delete account action with its own confirm step. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { SettingsModal } from './SettingsModal'

const renderModal = (
  overrides: Partial<{
    email: string
    onDeleteAccount: () => Promise<void>
    onDeleted: () => void
    onClose: () => void
  }> = {},
) =>
  render(
    <SettingsModal
      email="owner@example.com"
      onDeleteAccount={vi.fn().mockResolvedValue(undefined)}
      onDeleted={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  )

describe('SettingsModal (issue #84)', () => {
  it('shows the signed-in email and the delete action', () => {
    renderModal()

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
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
})
