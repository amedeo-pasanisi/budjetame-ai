import { useState, type FormEvent } from 'react'
import { useIntl } from 'react-intl'

import { ApiError } from './api'
import { Card, Screen } from './Screen'

type ResetPasswordProps = {
  /** The token from the emailed link's URL (?token=...). */
  token: string
  onReset: (token: string, newPassword: string) => Promise<void>
  /** Called after a successful reset; the app returns to the sign-in view. */
  onDone: () => void
}

/** The reset view reached from the emailed link (issue #83): one new
 * password, then back to sign-in. A 400 means the link is invalid, expired,
 * or already used. */
export function ResetPassword({ token, onReset, onDone }: ResetPasswordProps) {
  const { formatMessage } = useIntl()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onReset(token, password)
      onDone()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? formatMessage({ id: 'resetPassword.error.invalid' })
          : formatMessage({ id: 'resetPassword.error.other' }),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen>
      <Card>
        <h1 className="text-2xl font-semibold text-slate-900">Budjetame</h1>
        <p className="mt-1 text-sm text-slate-500">{formatMessage({ id: 'resetPassword.title' })}</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">
              {formatMessage({ id: 'resetPassword.newPassword' })}
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          {error !== null && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {submitting
              ? formatMessage({ id: 'resetPassword.setting' })
              : formatMessage({ id: 'resetPassword.set' })}
          </button>
        </form>
      </Card>
    </Screen>
  )
}