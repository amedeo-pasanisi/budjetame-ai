/** The shared API transport: one place that knows the base URL, the bearer
 * token, and how a non-OK response becomes an ApiError (issue #17). Every
 * resource module (auth, wallets, categories, transactions, dashboard,
 * import) goes through `request()`; nothing else touches `fetch` or the
 * wire format.
 */

const API_BASE = '/api'

export const TOKEN_KEY = 'budjetame.token'

export class ApiError extends Error {
  readonly status: number

  /** The backend's parsed `detail` when the response carried one — a string,
   * or a structured object like the category merge conflict (ADR-0007). */
  readonly detail: unknown

  constructor(message: string, status: number, detail?: unknown) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

/** Human message for an API failure, shared by every screen. The status codes
 * are part of the API contract (409 duplicate name, 422 validation). */
export function apiErrorMessage(
  error: ApiError,
  conflictMessage: string,
  fallback: string,
): string {
  if (error.status === 409) return conflictMessage
  if (error.status === 422) return 'Check the fields and try again.'
  return fallback
}

/** The backend's error detail, when it carries one (e.g. "Unknown wallet
 * 'X'"); the generic fallback otherwise. A string detail becomes the
 * message; a structured detail (ADR-0007's merge conflict) contributes its
 * `message` field and stays attached to the ApiError for the caller. */
function messageOr(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail !== '') {
    return detail
  }
  if (
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as { message?: unknown }).message === 'string' &&
    (detail as { message: string }).message !== ''
  ) {
    return (detail as { message: string }).message
  }
  return fallback
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  token?: string
  /** JSON body: serialized and sent with a Content-Type header. */
  json?: unknown
  /** Multipart body (import upload): sent as-is; the browser sets the boundary. */
  formData?: FormData
  /** The message carried by the ApiError when the request fails. */
  errorMessage: string
  /** Import endpoints surface the backend's error detail when it has one;
   * everything else shows the fixed `errorMessage`. */
  readDetail?: boolean
}

/** One fetch against the API: base URL, bearer token and JSON headers applied
 * here, a non-OK response thrown here as an ApiError. Callers parse the
 * response body (or ignore it for 204 deletes). */
export async function request(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`
  if (options.json !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.formData,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
    const detail = body?.detail ?? undefined
    throw new ApiError(
      options.readDetail === true ? messageOr(detail, options.errorMessage) : options.errorMessage,
      response.status,
      detail,
    )
  }
  return response
}
