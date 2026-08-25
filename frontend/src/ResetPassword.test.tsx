/** The reset view reached from the emailed link (issue #83): submits the new
 * password with the URL token, maps a 400 to the friendly "invalid or
 * expired" message, and reports success through onDone. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ApiError } from './api'
import { ResetPassword } from './ResetPassword'

describe('ResetPassword (issue #83)', () => {
  it('submits the new password with the token and reports success', async () => {
    const onReset = vi.fn().mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<ResetPassword token="link-token" onReset={onReset} onDone={onDone} />)

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'brand-new-pass-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() =>
      expect(onReset).toHaveBeenCalledWith('link-token', 'brand-new-pass-123'),
    )
    expect(onDone).toHaveBeenCalled()
  })

  it('shows the friendly message for an invalid, expired, or used link', async () => {
    const onReset = vi.fn().mockRejectedValue(new ApiError('Bad', 400))
    render(<ResetPassword token="dead-token" onReset={onReset} onDone={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'brand-new-pass-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() =>
      expect(
        screen.getByText('This reset link is invalid or has expired.'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'Set new password' })).toBeInTheDocument()
  })

  it('enforces the 8-character rule on the new password', () => {
    render(<ResetPassword token="t" onReset={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByLabelText('New password')).toHaveAttribute('minLength', '8')
  })
})
