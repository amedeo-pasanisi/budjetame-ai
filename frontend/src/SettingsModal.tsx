import { DeleteAccountButton } from './DeleteAccountButton'
import { ModalShell } from './ModalShell'

type SettingsModalProps = {
  email: string
  onDeleteAccount: () => Promise<void>
  onDeleted: () => void
  onClose: () => void
}

/** The app's settings (issue #84): account info and the destructive actions,
 * behind a gear in the header instead of cluttering every tab. Deletion keeps
 * its own confirm step and error surfacing (DeleteAccountButton). */
export function SettingsModal({ email, onDeleteAccount, onDeleted, onClose }: SettingsModalProps) {
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
