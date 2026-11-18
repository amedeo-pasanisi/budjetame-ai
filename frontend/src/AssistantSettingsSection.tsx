import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'

import { FieldError } from './FieldError'
import {
  ASSISTANT_PROVIDERS,
  TOKEN_KEY,
  fetchAssistantSettings,
  removeAssistantSettings,
  saveAssistantSettings,
  type AssistantProvider,
  type AssistantSettingsStatus,
} from './api'
import { fieldErrorProps, type FieldErrors } from './validation'

/** The block's Field Errors (ADR-0029): only the key is required — the
 * model is optional (empty means the provider's default) and the provider
 * is a select that always holds a value. */
function validate(key: string, requiredMessage: string): FieldErrors {
  const errors: FieldErrors = {}
  if (key.trim() === '') errors.assistantKey = requiredMessage
  return errors
}

/** The Assistant Settings block of the Settings modal (issue #126,
 * ADR-0035): a provider select, a write-only key field, a free-text model
 * id (the catalogue picker is a later ticket), Save, Remove and the status
 * line. No other knob. The key field is never pre-filled: the server reports
 * at most its last four characters, and Save sends provider, key and model
 * together — one setting per Account. Switching provider clears the typed
 * model, so the provider's default takes over unless one is typed. */
export function AssistantSettingsSection() {
  const { formatMessage } = useIntl()
  const [status, setStatus] = useState<AssistantSettingsStatus | null>(null)
  const [provider, setProvider] = useState<AssistantProvider>('anthropic')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const token = localStorage.getItem(TOKEN_KEY) ?? ''

  useEffect(() => {
    let cancelled = false
    fetchAssistantSettings(token)
      .then((loaded) => {
        if (cancelled) return
        setStatus(loaded)
        if (loaded.provider !== null) setProvider(loaded.provider)
        setModel(loaded.model ?? '')
      })
      .catch(() => {
        if (!cancelled) setError(formatMessage({ id: 'settings.assistant.loadError' }))
      })
    return () => {
      cancelled = true
    }
    // The token is read once on mount; the modal is re-mounted on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as AssistantProvider
    setProvider(next)
    setModel('')
  }

  const handleSave = async () => {
    const nextErrors = validate(key, formatMessage({ id: 'settings.assistant.key.required' }))
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setError(null)
    setBusy(true)
    try {
      // Trimming is the server's rule (services/assistant_settings.py).
      const saved = await saveAssistantSettings(token, { provider, key, model })
      setStatus(saved)
      setKey('')
      setModel(saved.model ?? '')
    } catch {
      setError(formatMessage({ id: 'settings.assistant.saveError' }))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    setErrors({})
    setError(null)
    setBusy(true)
    try {
      await removeAssistantSettings(token)
      setStatus({ configured: false, provider: null, model: null, last4: null })
      setKey('')
      setModel('')
    } catch {
      setError(formatMessage({ id: 'settings.assistant.removeError' }))
    } finally {
      setBusy(false)
    }
  }

  const statusLine =
    status === null
      ? formatMessage({ id: 'settings.assistant.status.loading' })
      : status.configured && status.provider !== null
        ? formatMessage(
            { id: 'settings.assistant.status.configured' },
            {
              provider: formatMessage({ id: `settings.assistant.provider.${status.provider}` }),
              model: status.model ?? '',
              last4: status.last4 ?? '',
            },
          )
        : formatMessage({ id: 'settings.assistant.status.notConfigured' })

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <p className="text-sm font-medium text-slate-900">{formatMessage({ id: 'settings.assistant' })}</p>
      <p className="mt-1 text-xs text-slate-500">{formatMessage({ id: 'settings.assistant.description' })}</p>
      <p className="mt-2 text-xs text-slate-700">{statusLine}</p>

      <div className="mt-3 flex flex-col gap-3">
        <div>
          <label htmlFor="assistant-provider" className="block text-xs font-medium text-slate-700">
            {formatMessage({ id: 'settings.assistant.provider' })}
          </label>
          <select
            id="assistant-provider"
            value={provider}
            onChange={handleProviderChange}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          >
            {ASSISTANT_PROVIDERS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {formatMessage({ id: `settings.assistant.provider.${candidate}` })}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="assistant-key" className="block text-xs font-medium text-slate-700">
            {formatMessage({ id: 'settings.assistant.key' })}
          </label>
          <input
            id="assistant-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={formatMessage({ id: 'settings.assistant.key.placeholder' })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            {...fieldErrorProps('assistantKey', errors)}
          />
          <FieldError field="assistantKey" errors={errors} />
        </div>

        <div>
          <label htmlFor="assistant-model" className="block text-xs font-medium text-slate-700">
            {formatMessage({ id: 'settings.assistant.model' })}
          </label>
          <input
            id="assistant-model"
            type="text"
            autoComplete="off"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={formatMessage({ id: 'settings.assistant.model.placeholder' })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {formatMessage({ id: busy ? 'settings.assistant.saving' : 'settings.assistant.save' })}
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {formatMessage({ id: 'settings.assistant.remove' })}
          </button>
        </div>
      </div>
    </div>
  )
}
