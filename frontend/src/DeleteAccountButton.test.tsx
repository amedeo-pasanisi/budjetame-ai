/** Account deletion (issue #84): the confirm gate, the error surfaced on
 * failure, and the sign-out hand-off on success. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DeleteAccountButton } from './DeleteAccountButton'

describe('DeleteAccountButton (issue #84)', () => {
  it('does nothing when the confirmation is declined', () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<DeleteAccountButton onDelete={onDelete} onDeleted={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(onDelete).not.toHaveBeenCalled()
  })

  it('deletes after confirmation and reports success', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<DeleteAccountButton onDelete={onDelete} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalled())
    expect(onDeleted).toHaveBeenCalled()
  })

  it('surfaces the error and stays put when the deletion fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('boom'))
    const onDeleted = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<DeleteAccountButton onDelete={onDelete} onDeleted={onDeleted} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() =>
      expect(screen.getByText('Could not delete the Account. Please try again.')).toBeInTheDocument(),
    )
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
