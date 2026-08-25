import { useState } from 'react'

type DeleteAccountButtonProps = {
  /** Deletes the Account; must throw on failure. */
  onDelete: () => Promise<void>
  /** Called after a successful deletion; the app signs out. */
  onDeleted: () => void
}

/** The self-service Account deletion affordance (issue #84): a confirm step
 * before the irreversible call, a clean error if it fails, and a call-back
 * on success so the app can sign out. */
export function DeleteAccountButton({ onDelete, onDeleted }: DeleteAccountButtonProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    if (!window.confirm('This permanently deletes your Account and all its data. Continue?')) {
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await onDelete()
      onDeleted()
    } catch {
      setError('Could not delete the Account. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm text-center">
      <button
        type="button"
        disabled={deleting}
        onClick={handleClick}
        className="text-sm font-medium text-red-600 disabled:opacity-60"
      >
        {deleting ? 'Deleting…' : 'Delete account'}
      </button>
      {error !== null && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
