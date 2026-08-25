/** Auth screen sign-up mode (issue #82): the sign-in/sign-up toggle, the
 * mode's labels and password rules, and the error mapping (409 duplicate
 * Account, 422 validation). The API client is injected through the
 * onLogin/onSignUp props; the real ApiError class carries the statuses. The
 * Google button is a separate component (issue #81) — mocked here as a bare
 * button so this file tests the auth screen's own wiring. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ApiError } from './api'
import { LoginForm } from './LoginForm'

vi.mock('./GoogleButton', () => ({
  GoogleButton: ({ onIdToken }: { onIdToken: (token: string) => void }) => (
    <button type="button" onClick={() => onIdToken('stub-token')}>
      Google
    </button>
  ),
}))

const noop = vi.fn().mockResolvedValue(undefined)

const renderForm = (
  overrides: Partial<{
    onLogin: (email: string, password: string) => Promise<void>
    onSignUp: (email: string, password: string) => Promise<void>
    onGoogleSignIn: (idToken: string) => Promise<void>
    onForgotPassword: (email: string) => Promise<void>
  }> = {},
) =>
  render(
    <LoginForm
      onLogin={noop}
      onSignUp={noop}
      onGoogleSignIn={noop}
      onForgotPassword={noop}
      {...overrides}
    />,
  )

describe('LoginForm sign-up mode (issue #82)', () => {
  it('starts in sign-in mode and toggles to sign-up and back', () => {
    renderForm()

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('submits the sign-up form with the typed credentials', async () => {
    const onSignUp = vi.fn().mockResolvedValue(undefined)
    renderForm({ onSignUp })

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(onSignUp).toHaveBeenCalledWith('new@example.com', 'hunter2-hunter2'),
    )
  })

  it('enforces the 8-character password rule on the sign-up form', () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '8')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autoComplete', 'new-password')
  })

  it('shows a friendly message when the email already has an Account', async () => {
    const onSignUp = vi
      .fn()
      .mockRejectedValue(new ApiError('Conflict', 409, 'An Account with this email already exists'))
    renderForm({ onSignUp })

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(screen.getByText('An Account with this email already exists.')).toBeInTheDocument(),
    )
  })

  it('shows a validation message on a 422 from the backend', async () => {
    const onSignUp = vi.fn().mockRejectedValue(new ApiError('Unprocessable', 422))
    renderForm({ onSignUp })

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByText('Check the fields and try again.')).toBeInTheDocument())
  })

  it('sign-in mode still submits through onLogin', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined)
    renderForm({ onLogin })

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('a@example.com', 'hunter2-hunter2'))
  })
})

describe('LoginForm Google sign-in (issue #81)', () => {
  it('shows the Google button in sign-in mode and hands the token through', async () => {
    const onGoogleSignIn = vi.fn().mockResolvedValue(undefined)
    renderForm({ onGoogleSignIn })

    fireEvent.click(screen.getByRole('button', { name: 'Google' }))

    await waitFor(() => expect(onGoogleSignIn).toHaveBeenCalledWith('stub-token'))
  })

  it('shows the Google button in sign-up mode too', () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument()
  })
})

describe('LoginForm forgot-password (issue #83)', () => {
  it('offers the reset link in sign-in mode and opens the email-only view', () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Reset it' }))

    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Google' })).not.toBeInTheDocument()
  })

  it('submits the email and shows the check-your-inbox state', async () => {
    const onForgotPassword = vi.fn().mockResolvedValue(undefined)
    renderForm({ onForgotPassword })

    fireEvent.click(screen.getByRole('button', { name: 'Reset it' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lost@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    await waitFor(() =>
      expect(onForgotPassword).toHaveBeenCalledWith('lost@example.com'),
    )
    expect(screen.getByText(/Check your inbox/)).toBeInTheDocument()
  })

  it('returns to sign-in from the forgot view', () => {
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Reset it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
})
