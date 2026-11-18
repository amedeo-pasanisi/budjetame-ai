/** Assistant Settings resource (issue #126, ADR-0035): the Account's
 * provider, Assistant Key and model. The key is write-only — it goes up in
 * `saveAssistantSettings` and every response is the status shape, which
 * carries at most its last four characters. */

import { request } from './transport'

export type AssistantProvider = 'anthropic' | 'openrouter' | 'gemini'

/** The fixed provider list, in the order the Settings select shows it. */
export const ASSISTANT_PROVIDERS: readonly AssistantProvider[] = ['anthropic', 'openrouter', 'gemini']

export type AssistantSettingsStatus = {
  /** A key is stored and readable by the server. */
  configured: boolean
  provider: AssistantProvider | null
  model: string | null
  /** The last four characters of the stored key, when configured. */
  last4: string | null
}

export type AssistantSettingsInput = {
  provider: AssistantProvider
  key: string
  /** Empty means the provider's default model. */
  model: string
}

/** The status of the Account's Assistant Settings: never the key. */
export async function fetchAssistantSettings(token: string): Promise<AssistantSettingsStatus> {
  const response = await request('/assistant/settings', {
    token,
    errorMessage: 'Could not load the Assistant Settings',
  })
  return (await response.json()) as AssistantSettingsStatus
}

/** Set or replace the provider, key and model in one call (one setting per
 * Account); an empty model means the provider's default. Returns the new
 * status. */
export async function saveAssistantSettings(
  token: string,
  input: AssistantSettingsInput,
): Promise<AssistantSettingsStatus> {
  const response = await request('/assistant/settings', {
    method: 'PUT',
    token,
    json: { provider: input.provider, key: input.key, model: input.model === '' ? null : input.model },
    errorMessage: 'Could not save the Assistant Settings',
  })
  return (await response.json()) as AssistantSettingsStatus
}

/** One model of a provider's catalogue (issue #127): the id Assistant
 * Settings store, the picker's label, and whether the provider prices it at
 * zero (OpenRouter's free models; nothing else is flagged). */
export type AssistantModel = {
  id: string
  label: string
  free: boolean
}

/** The models of `provider` for the picker (issue #127): Anthropic's fixed
 * three, OpenRouter's tool-capable public catalogue, or the models a Gemini
 * key can list. `key` is the key typed but not yet saved, sent in the
 * `X-Assistant-Key` header (never the query string, which access logs
 * print) so Gemini can list before Save; empty means "use the stored key
 * when it belongs to this provider". Rejections keep their status on the
 * ApiError: 409 no key where one is needed, 422 the provider rejected the
 * key, 502 the catalogue is unreachable. */
export async function fetchAssistantModels(
  token: string,
  provider: AssistantProvider,
  key: string,
): Promise<AssistantModel[]> {
  const response = await request(`/assistant/models?provider=${encodeURIComponent(provider)}`, {
    token,
    headers: key.trim() === '' ? undefined : { 'X-Assistant-Key': key.trim() },
    errorMessage: 'Could not load the Assistant models',
  })
  const body = (await response.json()) as { provider: AssistantProvider; models: AssistantModel[] }
  return body.models
}

/** Remove the provider, key and model together; the Account then has no
 * Assistant. */
export async function removeAssistantSettings(token: string): Promise<void> {
  await request('/assistant/settings', {
    method: 'DELETE',
    token,
    errorMessage: 'Could not remove the Assistant Settings',
  })
}
