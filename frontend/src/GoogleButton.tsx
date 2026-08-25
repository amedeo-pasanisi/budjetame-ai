import { useEffect, useRef, useState } from 'react'

import { fetchAuthConfig } from './api'
import { loadGoogleIdentityScript, renderGoogleButton } from './googleIdentity'

type GoogleButtonProps = {
  onIdToken: (idToken: string) => void
}

/** The "Sign in with Google" button (issue #81): asks the backend for the
 * client id (empty → no button), loads Google Identity Services, and hands
 * the ID token to the caller. Any failure hides the button — the password
 * form remains the fallback. */
export function GoogleButton({ onIdToken }: GoogleButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAuthConfig()
      .then((config) => {
        if (cancelled) return
        setClientId(config.google_client_id === '' ? null : config.google_client_id)
      })
      .catch(() => {
        if (!cancelled) setHidden(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (clientId === null || containerRef.current === null) return
    let cancelled = false
    loadGoogleIdentityScript()
      .then(() => {
        if (!cancelled && containerRef.current !== null) {
          renderGoogleButton(containerRef.current, clientId, onIdToken)
        }
      })
      .catch(() => {
        if (!cancelled) setHidden(true)
      })
    return () => {
      cancelled = true
    }
  }, [clientId, onIdToken])

  if (hidden || clientId === null) {
    return null
  }
  return <div ref={containerRef} className="w-full" />
}
