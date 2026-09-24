import { DeleteAccountButton } from './DeleteAccountButton'
import { ModalShell } from './ModalShell'
import { TOKEN_KEY, exportBackup } from './api'

type SettingsModalProps = {
  email: string
  onDeleteAccount: () => Promise<void>
  onDeleted: () => void
  onClose: () => void
}

/** The app's settings (issue #84): account info, the export-all backup action
 * (issue #112), and the destructive actions, behind a gear in the header
 * instead of cluttering every tab. Deletion keeps its own confirm step and
 * error surfacing (DeleteAccountButton). */
export function SettingsModal({ email, onDeleteAccount, onDeleted, onClose }: SettingsModalProps) {
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
