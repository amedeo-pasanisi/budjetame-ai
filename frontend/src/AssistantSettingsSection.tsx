import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'

import { FieldError } from './FieldError'
import {
  ASSISTANT_PROVIDERS,
  ApiError,
  TOKEN_KEY,
  fetchAssistantModels,
  fetchAssistantSettings,
  removeAssistantSettings,
  saveAssistantSettings,
  type AssistantModel,
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

/** What the picker shows under itself: nothing, a loading line, or the
 * reason the list is empty (keyed by the listing's status, issue #127). */
type CatalogueState = 'idle' | 'loading' | 'ready' | 'keyNeeded' | 'keyRejected' | 'error'

function catalogueStateFor(error: unknown): CatalogueState {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'keyNeeded'
    // The handler's 422 carries its message as a string detail; FastAPI's
    // own validation 422 (a list) is a client bug, reported as a plain failure.
    if (error.status === 422 && typeof error.detail === 'string') return 'keyRejected'
  }
  return 'error'
}

const CATALOGUE_MESSAGES: Partial<Record<CatalogueState, string>> = {
  loading: 'settings.assistant.model.loading',
  keyNeeded: 'settings.assistant.model.keyNeeded',
  keyRejected: 'settings.assistant.model.keyRejected',
  error: 'settings.assistant.model.loadError',
}

/** The Assistant Settings block of the Settings modal (issue #126,
 * ADR-0035): a provider select, a write-only key field, the model picker
 * fed by the provider's catalogue (issue #127) with a free-text id that
 * overrides it, Save, Remove and the status line. No other knob. The key
 * field is never pre-filled: the server reports at most its last four
 * characters, and Save sends provider, key and model together — one
 * setting per Account. Switching provider clears the model, so the
 * provider's default takes over unless one is picked or typed.
 *
 * The picker lists once the status is loaded (so the first listing is the
 * configured provider's), again on every provider change, and for Gemini
 * — which lists only with a key — again when the key field is left with a
 * key typed in it, sent along before Save. The model id is one string: the
 * picker shows it when it is in the list, as "(typed)" when it is not. */
export function AssistantSettingsSection() {
  const { formatMessage } = useIntl()
  const [status, setStatus] = useState<AssistantSettingsStatus | null>(null)
  const [provider, setProvider] = useState<AssistantProvider>('anthropic')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<AssistantModel[]>([])
  const [catalogue, setCatalogue] = useState<CatalogueState>('idle')
  // The key as it was when its field was last left: Gemini lists with it.
  const [leftKey, setLeftKey] = useState('')

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

  const statusLoaded = status !== null
  const keyForListing = provider === 'gemini' ? leftKey : ''

  useEffect(() => {
    if (!statusLoaded) return
    let cancelled = false
    setCatalogue('loading')
    fetchAssistantModels(token, provider, keyForListing)
      .then((loaded) => {
        if (cancelled) return
        setModels(loaded)
        setCatalogue('ready')
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        setModels([])
        setCatalogue(catalogueStateFor(failure))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusLoaded, provider, keyForListing])

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
      setLeftKey('')
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
      setLeftKey('')
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

  const typedModel = model !== '' && !models.some((candidate) => candidate.id === model)
  const catalogueMessageId = CATALOGUE_MESSAGES[catalogue]

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
            onBlur={() => setLeftKey(key.trim())}
            placeholder={formatMessage({ id: 'settings.assistant.key.placeholder' })}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
            {...fieldErrorProps('assistantKey', errors)}
          />
          <FieldError field="assistantKey" errors={errors} />
        </div>

        <div>
          <label htmlFor="assistant-model-picker" className="block text-xs font-medium text-slate-700">
            {formatMessage({ id: 'settings.assistant.model.picker' })}
          </label>
          <select
            id="assistant-model-picker"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.length === 0}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">{formatMessage({ id: 'settings.assistant.model.picker.default' })}</option>
            {typedModel && (
              <option value={model}>
                {formatMessage({ id: 'settings.assistant.model.picker.typed' }, { model })}
              </option>
            )}
            {models.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.free
                  ? formatMessage({ id: 'settings.assistant.model.freeOption' }, { label: candidate.label })
                  : candidate.label}
              </option>
            ))}
          </select>
          {catalogueMessageId && (
            <p className="mt-1 text-xs text-slate-500">{formatMessage({ id: catalogueMessageId })}</p>
          )}
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
          <p className="mt-1 text-xs text-slate-500">{formatMessage({ id: 'settings.assistant.model.override' })}</p>
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
