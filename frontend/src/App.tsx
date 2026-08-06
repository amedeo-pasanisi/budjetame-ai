import { useEffect, useState } from 'react'

import { TOKEN_KEY, fetchCurrentAccount, login, type Account } from './api'
import { LoginForm } from './LoginForm'
import { Screen } from './Screen'
import { WalletsScreen } from './WalletsScreen'

type AuthState =
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; account: Account }

function App() {
  const [auth, setAuth] = useState<AuthState>(() =>
    localStorage.getItem(TOKEN_KEY) !== null ? { kind: 'checking' } : { kind: 'signedOut' },
  )
  const [authCheckVersion, setAuthCheckVersion] = useState(0)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (token === null) {
      setAuth({ kind: 'signedOut' })
      return
    }
    let cancelled = false
    setAuth({ kind: 'checking' })
    fetchCurrentAccount(token)
      .then((account) => {
        if (!cancelled) setAuth({ kind: 'signedIn', account })
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem(TOKEN_KEY)
        setAuth({ kind: 'signedOut' })
      })
    return () => {
      cancelled = true
    }
  }, [authCheckVersion])

  const handleLogin = async (email: string, password: string): Promise<void> => {
    const token = await login(email, password)
    localStorage.setItem(TOKEN_KEY, token)
    setAuthCheckVersion((count) => count + 1)
  }

  const handleSignOut = () => {
    localStorage.removeItem(TOKEN_KEY)
    setAuth({ kind: 'signedOut' })
  }

  if (auth.kind === 'checking') {
    return <CheckingScreen />
  }
  if (auth.kind === 'signedOut') {
    return <LoginForm onLogin={handleLogin} />
  }
  return <AppShell email={auth.account.email} onSignOut={handleSignOut} />
}

function CheckingScreen() {
  return (
    <Screen>
      <p className="text-sm text-slate-500">Signing you in…</p>
    </Screen>
  )
}

function AppShell({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  return <WalletsScreen email={email} onSignOut={onSignOut} />
}

export default App
