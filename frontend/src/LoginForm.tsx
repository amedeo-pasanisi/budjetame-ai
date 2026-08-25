import { useState, type FormEvent } from 'react'

import { ApiError } from './api'
import { GoogleButton } from './GoogleButton'
import { Card, Screen } from './Screen'

/** The auth screen's views: the two doors (password, Google) plus the
 * forgot-password flow. */
type Mode = 'signin' | 'signup' | 'forgot'

type LoginFormProps = {
  onLogin: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<void>
  onGoogleSignIn: (idToken: string) => Promise<void>
  onForgotPassword: (email: string) => Promise<void>
}

export function LoginForm({ onLogin, onSignUp, onGoogleSignIn, onForgotPassword }: LoginFormProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'forgot') {
        await onForgotPassword(email)
        setResetSent(true)
      } else if (mode === 'signin') {
        await onLogin(email, password)
      } else {
        await onSignUp(email, password)
      }
    } catch (err) {
      if (mode === 'forgot') {
        setError('Could not send the reset link. Please try again.')
      } else if (mode === 'signin') {
        setError(
          err instanceof ApiError && err.status === 401
            ? 'Incorrect email or password.'
            : 'Could not sign in. Please try again.',
        )
      } else {
        setError(
          err instanceof ApiError && err.status === 409
            ? 'An Account with this email already exists.'
            : err instanceof ApiError && err.status === 422
              ? 'Check the fields and try again.'
              : 'Could not sign up. Please try again.',
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setResetSent(false)
  }

  const signUp = mode === 'signup'

  return (
    <Screen>
      <Card>
        <h1 className="text-2xl font-semibold text-slate-900">Budjetame</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'forgot'
            ? 'We will email you a link to reset your password.'
            : signUp
              ? 'Create an Account to see your money.'
              : 'Sign in to see your money.'}
        </p>
        {mode !== 'forgot' && (
          <>
            <div className="mt-6">
              <GoogleButton onIdToken={onGoogleSignIn} />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          </>
        )}
        {resetSent ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-700">
              Check your inbox — the link works once and expires soon.
            </p>
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            {mode !== 'forgot' && (
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={signUp ? 8 : undefined}
                  autoComplete={signUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            )}
            {error !== null && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
            >
              {submitting
                ? mode === 'forgot'
                  ? 'Sending…'
                  : signUp
                    ? 'Creating…'
                    : 'Signing in…'
                : mode === 'forgot'
                  ? 'Send reset link'
                  : signUp
                    ? 'Create account'
                    : 'Sign in'}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-slate-500">
          {mode === 'signin' && (
            <>
              Forgot your password?{' '}
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="font-medium text-indigo-600"
              >
                Reset it
              </button>
            </>
          )}
        </p>
        <p className="mt-2 text-center text-sm text-slate-500">
          {mode === 'forgot' ? (
            <>
              Remembered it?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="font-medium text-indigo-600"
              >
                Sign in
              </button>
            </>
          ) : signUp ? (
            <>
              Already have an Account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="font-medium text-indigo-600"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don't have an Account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="font-medium text-indigo-600"
              >
                Sign up
              </button>
            </>
          )}
        </p>
      </Card>
    </Screen>
  )
}
