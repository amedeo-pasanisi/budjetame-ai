/** Auth screen sign-up mode (issue #82): the sign-in/sign-up toggle, the
 * mode's labels and password rules, and the error mapping (409 duplicate
 * Account, 422 validation). The API client is injected through the
 * onLogin/onSignUp props; the real ApiError class carries the statuses. */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ApiError } from './api'
import { LoginForm } from './LoginForm'

describe('LoginForm sign-up mode (issue #82)', () => {
  it('starts in sign-in mode and toggles to sign-up and back', () => {
    render(<LoginForm onLogin={vi.fn()} onSignUp={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('submits the sign-up form with the typed credentials', async () => {
    const onSignUp = vi.fn().mockResolvedValue(undefined)
    render(<LoginForm onLogin={vi.fn()} onSignUp={onSignUp} />)

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(onSignUp).toHaveBeenCalledWith('new@example.com', 'hunter2-hunter2'),
    )
  })

  it('enforces the 8-character password rule on the sign-up form', () => {
    render(<LoginForm onLogin={vi.fn()} onSignUp={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))

    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '8')
    expect(screen.getByLabelText('Password')).toHaveAttribute('autoComplete', 'new-password')
  })

  it('shows a friendly message when the email already has an Account', async () => {
    const onSignUp = vi
      .fn()
      .mockRejectedValue(new ApiError('Conflict', 409, 'An Account with this email already exists'))
    render(<LoginForm onLogin={vi.fn()} onSignUp={onSignUp} />)

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
    render(<LoginForm onLogin={vi.fn()} onSignUp={onSignUp} />)

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(screen.getByText('Check the fields and try again.')).toBeInTheDocument())
  })

  it('sign-in mode still submits through onLogin', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined)
    render(<LoginForm onLogin={onLogin} onSignUp={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2-hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('a@example.com', 'hunter2-hunter2'))
  })
})
