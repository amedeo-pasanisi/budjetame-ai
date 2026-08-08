import { useEffect, useState } from 'react'

import { TOKEN_KEY, fetchCurrentAccount, login, type Account } from './api'
import { CategoriesScreen } from './CategoriesScreen'
import { HistoryScreen } from './HistoryScreen'
import { LoginForm } from './LoginForm'
import { Screen } from './Screen'
import { TransactionsScreen } from './TransactionsScreen'
import { WalletsScreen } from './WalletsScreen'

type AuthState =
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; account: Account }

type Tab = 'wallets' | 'transactions' | 'history' | 'categories'

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
  const [tab, setTab] = useState<Tab>('wallets')

  return (
    <div className="min-h-svh bg-slate-50 px-4 py-6">
      <header className="mx-auto flex max-w-sm items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Budjetame</h1>
          <p className="mt-0.5 text-xs text-slate-500">{email}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
        >
          Sign out
        </button>
      </header>

      <nav className="mx-auto mt-5 flex max-w-sm gap-2 rounded-xl border border-slate-200 bg-white p-1">
        <TabButton active={tab === 'wallets'} onClick={() => setTab('wallets')}>
          Wallets
        </TabButton>
        <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>
          Transactions
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          History
        </TabButton>
        <TabButton active={tab === 'categories'} onClick={() => setTab('categories')}>
          Categories
        </TabButton>
      </nav>

      <main className="mx-auto mt-6 max-w-sm">
        {tab === 'wallets' && <WalletsScreen />}
        {tab === 'transactions' && <TransactionsScreen />}
        {tab === 'history' && <HistoryScreen />}
        {tab === 'categories' && <CategoriesScreen />}
      </main>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
        active ? 'bg-indigo-600 text-white' : 'text-slate-600'
      }`}
    >
      {children}
    </button>
  )
}

export default App
