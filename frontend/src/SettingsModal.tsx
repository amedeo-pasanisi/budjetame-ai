import { useState, useRef } from 'react'
import { DeleteAccountButton } from './DeleteAccountButton'
import { ModalShell } from './ModalShell'
import { TOKEN_KEY, exportBackup, restoreBackup } from './api'

type SettingsModalProps = {
  email: string
  language: string
  onChangeLanguage: (language: 'en' | 'it') => void
  onDeleteAccount: () => Promise<void>
  onDeleted: () => void
  onClose: () => void
  /** Called after a successful restore — parent should clear undo stack. */
  onRestored?: () => void
}

type RestoreStep = 'idle' | 'confirm' | 'warning' | 'restoring' | 'done' | 'error'

/** The app's settings (issue #84): account info, the display Locale picker
 * (issue #114), the export-all backup action (issue #112), the Restore from
 * backup flow (issue #115), and the destructive actions, behind a gear in
 * the header instead of cluttering every tab. */
export function SettingsModal({ email, language, onChangeLanguage, onDeleteAccount, onDeleted, onClose, onRestored }: SettingsModalProps) {
  const [restoreStep, setRestoreStep] = useState<RestoreStep>('idle')
  const [restoreWarning, setRestoreWarning] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const fileRef = useRef<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (next === 'en' || next === 'it') {
      onChangeLanguage(next)
    }
  }

  const handleExportAll = async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token === null) return
    const { blob, filename } = await exportBackup(token)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }

  /** Offer a current-state Export all before committing to restore. */
  const handleExportBeforeRestore = async () => {
    await handleExportAll()
  }

  /** Trigger the file picker for a backup workbook. */
  const handlePickBackupFile = () => {
    fileInputRef.current?.click()
  }

  /** After picking a file, show the first confirmation step. */
  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    fileRef.current = file
    setRestoreStep('confirm')
    setRestoreWarning(null)
    setRestoreError(null)
  }

  /** Proceed with the actual restore after the second confirmation. */
  const handleConfirmRestore = async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token === null || !fileRef.current) return

    setRestoreStep('restoring')
    setRestoreError(null)
    try {
      const result = await restoreBackup(token, fileRef.current)
      if (result.warning) {
        setRestoreWarning(result.warning)
        setRestoreStep('warning')
      } else {
        setRestoreStep('done')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Restore failed'
      setRestoreError(message)
      setRestoreStep('error')
    }
  }

  /** Dismiss the warning and mark the restore as done. */
  const handleDismissWarning = () => {
    setRestoreStep('done')
  }

  /** Reset to idle when closing the restore flow. */
  const handleCancelRestore = () => {
    setRestoreStep('idle')
    fileRef.current = null
    setRestoreWarning(null)
    setRestoreError(null)
  }

  /** Close the whole modal once the restore is done. */
  const handleDoneClose = () => {
    onRestored?.()
    onClose()
  }

  // --- Render the current step ---
  if (restoreStep === 'confirm') {
    return (
      <ModalShell label="Settings" onClose={onClose}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Restore from backup</h2>
          <button
            type="button"
            onClick={handleCancelRestore}
            aria-label="Cancel restore"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          This will replace all your current Transactions, Wallets,
          Categories, and Recurring definitions with the backup file's
          contents. This cannot be undone.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleExportBeforeRestore}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export current state first
          </button>
          <button
            type="button"
            onClick={handleConfirmRestore}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Restore from backup
          </button>
          <button
            type="button"
            onClick={handleCancelRestore}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </ModalShell>
    )
  }

  if (restoreStep === 'restoring') {
    return (
      <ModalShell label="Settings" onClose={onClose}>
        <h2 className="text-lg font-semibold text-slate-900">Restoring…</h2>
        <p className="mt-2 text-sm text-slate-700">Replacing your data from the backup file.</p>
      </ModalShell>
    )
  }

  if (restoreStep === 'warning') {
    return (
      <ModalShell label="Settings" onClose={onClose}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Origin mismatch</h2>
          <button
            type="button"
            onClick={handleDismissWarning}
            aria-label="Dismiss warning"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
          >
            ✕
          </button>
        </div>
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {restoreWarning}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          The backup was exported from a different Account. Restoring will
          replace all your data with the backup's contents. This is a
          legitimate way to migrate data between Accounts.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={handleDismissWarning}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Continue
          </button>
        </div>
      </ModalShell>
    )
  }

  if (restoreStep === 'done') {
    return (
      <ModalShell label="Settings" onClose={onClose}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Restore complete</h2>
          <button
            type="button"
            onClick={handleDoneClose}
            aria-label="Close settings"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          Your Account data has been replaced with the backup file's contents.
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleDoneClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </ModalShell>
    )
  }

  if (restoreStep === 'error') {
    return (
      <ModalShell label="Settings" onClose={onClose}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Restore failed</h2>
          <button
            type="button"
            onClick={handleCancelRestore}
            aria-label="Cancel restore"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
          >
            ✕
          </button>
        </div>
        {restoreError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {restoreError}
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          The backup file could not be restored. No data was changed.
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={handleCancelRestore}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      </ModalShell>
    )
  }

  // --- Idle: the full settings view ---
  return (
    <ModalShell label="Settings" onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600"
        >
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{email}</p>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-900">Language</p>
        <p className="mt-1 text-xs text-slate-500">
          Display Locale: numbers and dates format according to this setting.
        </p>
        <div className="mt-3">
          <select
            value={language}
            onChange={handleLanguageChange}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          >
            <option value="en">English</option>
            <option value="it">Italiano</option>
          </select>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-900">Export all</p>
        <p className="mt-1 text-xs text-slate-500">
          Downloads your complete Account data as a multi-sheet backup workbook.
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={handleExportAll}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Export all
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-900">Restore from backup…</p>
        <p className="mt-1 text-xs text-slate-500">
          Replace all your data with the contents of a previously exported backup workbook.
        </p>
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFilePicked}
            className="hidden"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={handlePickBackupFile}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Choose file…
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-900">Delete account</p>
        <p className="mt-1 text-xs text-slate-500">
          Permanently deletes your Account and all its data.
        </p>
        <div className="mt-3">
          <DeleteAccountButton onDelete={onDeleteAccount} onDeleted={onDeleted} />
        </div>
      </div>
    </ModalShell>
  )
}