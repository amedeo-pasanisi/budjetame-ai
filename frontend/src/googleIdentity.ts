/** Google Identity Services glue (issue #81): loads the GSI script and
 * renders the sign-in button. Its own module so component tests can stub
 * the script-loading seam — jsdom has no network and no window.google. */

export type GoogleIdentityApi = {
  google?: {
    accounts?: {
      id: {
        initialize: (config: {
          client_id: string
          callback: (response: { credential: string }) => void
        }) => void
        renderButton: (container: HTMLElement, options: Record<string, unknown>) => void
      }
    }
  }
}

/** Inject Google Identity Services into the page; resolves when ready,
 * rejects when the script cannot load. Idempotent. */
export function loadGoogleIdentityScript(): Promise<void> {
  if ((window as GoogleIdentityApi).google?.accounts !== undefined) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google sign-in'))
    document.head.appendChild(script)
  })
}

/** Initialize GSI and draw the button into `container`; each click hands the
 * Google-issued ID token to `onIdToken`. */
export function renderGoogleButton(
  container: HTMLElement,
  clientId: string,
  onIdToken: (idToken: string) => void,
): void {
  const gsi = (window as GoogleIdentityApi).google?.accounts?.id
  if (gsi === undefined) {
    return
  }
  gsi.initialize({
    client_id: clientId,
    callback: (response: { credential: string }) => onIdToken(response.credential),
  })
  gsi.renderButton(container, {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    width: Math.max(container.clientWidth, 280),
  })
}
