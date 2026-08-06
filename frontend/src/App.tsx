import { useEffect, useState } from 'react'

import { fetchCurrentAccount, login, type Account } from './api'
import { LoginForm } from './LoginForm'
import { Card, Screen } from './Screen'

const TOKEN_KEY = 'budjetame.token'

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

  if (auth.kind === 'checking') {
    return <CheckingScreen />
  }
  if (auth.kind === 'signedOut') {
    return <LoginForm onLogin={handleLogin} />
  }
  return <AppShell email={auth.account.email} />
}

function CheckingScreen() {
  return (
    <Screen>
      <p className="text-sm text-slate-500">Signing you in…</p>
    </Screen>
  )
}

function AppShell({ email }: { email: string }) {
  return (
    <Screen>
      <Card>
        <h1 className="text-2xl font-semibold text-slate-900">Budjetame</h1>
        <p className="mt-2 text-sm text-slate-500">
          Signed in as {email}. Features land here ticket by ticket.
        </p>
      </Card>
    </Screen>
  )
}

export default App
