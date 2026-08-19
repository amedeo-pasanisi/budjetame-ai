import { useEffect, useState } from 'react'

import { TOKEN_KEY, fetchCurrentAccount, login, type Account } from './api'
import { CategoriesScreen } from './CategoriesScreen'
import { DashboardScreen } from './DashboardScreen'
import { useImportDraft } from './importDraft'
import { LoginForm } from './LoginForm'
import { RecurringScreen } from './RecurringScreen'
import { Screen } from './Screen'
import { useTabSwipe } from './tabSwipe'
import { TransactionsScreen } from './TransactionsScreen'
import { WalletsScreen } from './WalletsScreen'

type AuthState =
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; account: Account }

type Tab = 'dashboard' | 'wallets' | 'transactions' | 'categories' | 'recurring'

/** The tabs in bottom-nav order — the swipe walks this list (issue #51). */
const TAB_ORDER: readonly Tab[] = [
  'dashboard',
  'wallets',
  'transactions',
  'categories',
  'recurring',
]

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

export function AppShell({
  email,
  onSignOut,
}: {
  email: string
  onSignOut: () => void
}) {
  const [tab, setTab] = useState<Tab>('dashboard')
  // The Import Draft lives here, not in the Transactions screen, so it
  // survives the screen unmounting on a tab switch (issue #43).
  const importState = useImportDraft()

  // Swipe between tabs (issue #51): one step per gesture, clamped at the
  // ends. The gesture evaluator only ever asks for a direction, never a
  // target tab, so tab state stays a plain value in the shell.
  const handleTabSwipe = (direction: 1 | -1) => {
    setTab((current) => {
      const next = TAB_ORDER.indexOf(current) + direction
      if (next < 0 || next >= TAB_ORDER.length) {
        return current
      }
      return TAB_ORDER[next]
    })
  }
  const swipeHandlers = useTabSwipe(handleTabSwipe)

  return (
    <div className="min-h-svh bg-slate-50 px-4 pt-6 pb-24">
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

      <main className="mx-auto mt-6 max-w-sm" {...swipeHandlers}>
        {tab === 'dashboard' && <DashboardScreen />}
        {tab === 'wallets' && <WalletsScreen />}
        {tab === 'transactions' && <TransactionsScreen importState={importState} />}
        {tab === 'categories' && <CategoriesScreen />}
        {tab === 'recurring' && <RecurringScreen />}
      </main>

      {/* Five tabs (issue #56 added Recurring): one bottom row on a phone,
       * full-width, five equal columns. */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-sm grid-cols-5 gap-0.5 px-2 py-1.5">
          <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
            Dashboard
          </TabButton>
          <TabButton active={tab === 'wallets'} onClick={() => setTab('wallets')}>
            Wallets
          </TabButton>
          <TabButton
            active={tab === 'transactions'}
            onClick={() => setTab('transactions')}
          >
            Transactions
          </TabButton>
          <TabButton active={tab === 'categories'} onClick={() => setTab('categories')}>
            Categories
          </TabButton>
          <TabButton active={tab === 'recurring'} onClick={() => setTab('recurring')}>
            Recurring
          </TabButton>
        </div>
      </nav>
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
      className={`truncate rounded-lg px-0.5 py-2 text-[11px] font-medium ${
        active ? 'bg-indigo-600 text-white' : 'text-slate-600'
      }`}
    >
      {children}
    </button>
  )
}

export default App
