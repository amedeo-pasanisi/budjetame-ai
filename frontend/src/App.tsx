import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { TOKEN_KEY, deleteAccount, fetchCurrentAccount, googleSignIn, login, register, requestPasswordReset, resetPassword, type Account } from './api'
import { CategoriesScreen } from './CategoriesScreen'
import { DashboardScreen } from './DashboardScreen'
import { useImportDraft, type ImportDraftController } from './importDraft'
import { LoginForm } from './LoginForm'
import { RecurringScreen } from './RecurringScreen'
import { ResetPassword } from './ResetPassword'
import { Screen } from './Screen'
import { SettingsModal } from './SettingsModal'
import { useTabSwipe } from './tabSwipe'
import { TransactionsScreen } from './TransactionsScreen'
import { WalletsScreen } from './WalletsScreen'

type AuthState =
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; account: Account }

type Tab = 'dashboard' | 'wallets' | 'transactions' | 'categories' | 'recurring'

/** The ledger jump (issue #90): a Wallet or Category row on its own tab
 * asks the Transactions tab to open with the ledger pre-filtered to that
 * entity. The request lives in the shell — the Transactions panel mounts
 * lazily on its first visit (ADR-0022), so the request must survive until
 * the screen exists to consume it, exactly like the Import Draft. */
export type LedgerFilterRequest = {
  kind: 'wallet' | 'category'
  id: number
}

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
  // The reset link's token, when the app was opened from /reset-password?token=...
  const [resetToken, setResetToken] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('token'),
  )

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
    await signInWith(login(email, password))
  }

  const handleSignUp = async (email: string, password: string): Promise<void> => {
    await signInWith(register(email, password))
  }

  const handleGoogleSignIn = async (idToken: string): Promise<void> => {
    try {
      await signInWith(googleSignIn(idToken))
    } catch {
      // A rejected Google token (clock skew, wrong origin) leaves the user
      // on the auth screen; the password form remains the fallback.
    }
  }

  const handleForgotPassword = async (email: string): Promise<void> => {
    await requestPasswordReset(email)
  }

  const handleResetPassword = async (token: string, newPassword: string): Promise<void> => {
    await resetPassword(token, newPassword)
  }

  const clearResetToken = () => {
    setResetToken(null)
    window.history.replaceState(null, '', window.location.pathname)
  }

  /** Store the bearer token and re-check /auth/me, which flips the screen
   * to the app shell. Shared by every sign-in door (issue #81). */
  const signInWith = async (tokenPromise: Promise<string>): Promise<void> => {
    const token = await tokenPromise
    localStorage.setItem(TOKEN_KEY, token)
    setAuthCheckVersion((count) => count + 1)
  }

  const handleSignOut = () => {
    localStorage.removeItem(TOKEN_KEY)
    setAuth({ kind: 'signedOut' })
  }

  const handleDeleteAccount = async (): Promise<void> => {
    await deleteAccount(localStorage.getItem(TOKEN_KEY) ?? '')
    // The Account is gone; the shell's onDeleted (= handleSignOut) clears the
    // dead token and returns to the auth screen (issue #84).
  }

  if (auth.kind === 'checking') {
    return <CheckingScreen />
  }
  if (auth.kind === 'signedOut') {
    if (resetToken !== null) {
      return <ResetPassword token={resetToken} onReset={handleResetPassword} onDone={clearResetToken} />
    }
    return (
      <LoginForm
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onGoogleSignIn={handleGoogleSignIn}
        onForgotPassword={handleForgotPassword}
      />
    )
  }
  return <AppShell email={auth.account.email} onSignOut={handleSignOut} onDeleteAccount={handleDeleteAccount} />
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
  onDeleteAccount,
}: {
  email: string
  onSignOut: () => void
  onDeleteAccount: () => Promise<void>
}) {
  const [tab, setTab] = useState<Tab>('dashboard')
  // Tab keep-alive (ADR-0022): a tab mounts on its first visit and stays
  // mounted afterwards, hidden with the `hidden` attribute — switching back
  // renders instantly from the data already loaded. Writes anywhere bump
  // the data version (transport.ts), so every mounted tab re-fetches in the
  // background; nothing is stale when the user returns.
  const [visited, setVisited] = useState<Partial<Record<Tab, boolean>>>({
    dashboard: true,
  })

  /** Switch tabs, lazily mounting the target and hiding the previous ones. */
  const activate = (tab: Tab) => {
    // A hidden panel keeps its DOM — focus included: blur the active element
    // so the focus ring and the soft keyboard don't linger on the tab that
    // was left behind.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setTab(tab)
    setVisited((current) => (current[tab] ? current : { ...current, [tab]: true }))
  }

  const [settingsOpen, setSettingsOpen] = useState(false)
  // The Import Draft lives here, not in the Transactions screen, so it
  // survives tab switches (issue #43) — under keep-alive the screen never
  // unmounts, and the shell-owned draft is what it was from the start.
  const importState = useImportDraft()

  // The pending ledger jump (issue #90): a Wallet/Category row requested
  // the Transactions ledger pre-filtered to it, and the request waits here
  // until the Transactions screen consumes it. Shell state, not screen
  // state: the request can arrive before the Transactions panel exists
  // (it mounts lazily on first visit, ADR-0022), and it must not be lost
  // while the screen is showing the Import Draft. A newer request replaces
  // an unconsumed one.
  const [pendingLedgerRequest, setPendingLedgerRequest] =
    useState<LedgerFilterRequest | null>(null)

  /** Send a ledger jump: hold the request pending and switch to the
   * Transactions tab — the screen applies it on first mount (initial
   * state) or, when already mounted, through the filter-change reload.
   * Passed to the Wallets and Categories screens; their rows wire it
   * (issues #93/#94). */
  const requestLedgerFilter = (request: LedgerFilterRequest) => {
    setPendingLedgerRequest(request)
    activate('transactions')
  }

  /** The consume side of the jump: the Transactions screen calls this once
   * it has applied the pending request. Cleared, the request cannot reach
   * a later render as stale state. */
  const consumeLedgerRequest = useCallback(() => {
    setPendingLedgerRequest(null)
  }, [])

  // Swipe between tabs (issue #51): one step per gesture, clamped at the
  // ends. The gesture evaluator only ever asks for a direction, never a
  // target tab, so tab state stays a plain value in the shell.
  const handleTabSwipe = (direction: 1 | -1) => {
    const next = TAB_ORDER.indexOf(tab) + direction
    if (next >= 0 && next < TAB_ORDER.length) {
      activate(TAB_ORDER[next])
    }
  }
  const swipeHandlers = useTabSwipe(handleTabSwipe)

  return (
    <div className="min-h-svh bg-slate-50 px-4 pt-6 pb-24">
      <header className="mx-auto flex max-w-sm items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Budjetame</h1>
          <p className="mt-0.5 text-xs text-slate-500">{email}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
          >
            Sign out
          </button>
        </div>
      </header>

      {settingsOpen && (
        <SettingsModal
          email={email}
          onDeleteAccount={onDeleteAccount}
          onDeleted={onSignOut}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <main className="mx-auto mt-6 max-w-sm" {...swipeHandlers}>
        {TAB_ORDER.filter((candidate) => visited[candidate]).map((candidate) => (
          <div key={candidate} data-tab={candidate} hidden={candidate !== tab}>
            {tabContent(
              candidate,
              importState,
              pendingLedgerRequest,
              consumeLedgerRequest,
              requestLedgerFilter,
            )}
          </div>
        ))}
      </main>

      {/* Five tabs (issue #56 added Recurring): one bottom row on a phone,
       * full-width, five equal columns. */}
      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-sm grid-cols-5 gap-0.5 px-2 py-1.5">
          <TabButton active={tab === 'dashboard'} onClick={() => activate('dashboard')}>
            Dashboard
          </TabButton>
          <TabButton active={tab === 'wallets'} onClick={() => activate('wallets')}>
            Wallets
          </TabButton>
          <TabButton
            active={tab === 'transactions'}
            onClick={() => activate('transactions')}
          >
            Transactions
          </TabButton>
          <TabButton active={tab === 'categories'} onClick={() => activate('categories')}>
            Categories
          </TabButton>
          <TabButton active={tab === 'recurring'} onClick={() => activate('recurring')}>
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

/** The screen each tab renders, inside its keep-alive panel (ADR-0022): the
 * panel mounts the screen on the tab's first visit and hides it — `hidden`
 * attribute, not unmount — while another tab is active. The ledger jump
 * (issue #90) rides the same channel: the pending request and its consume
 * callback go to the Transactions screen; the request setter goes to the
 * Wallets and Categories screens, whose rows fire it (issues #93/#94). */
function tabContent(
  tab: Tab,
  importState: ImportDraftController,
  pendingLedgerRequest: LedgerFilterRequest | null,
  consumeLedgerRequest: () => void,
  requestLedgerFilter: (request: LedgerFilterRequest) => void,
): ReactNode {
  switch (tab) {
    case 'dashboard':
      return <DashboardScreen />
    case 'wallets':
      return <WalletsScreen requestLedgerFilter={requestLedgerFilter} />
    case 'transactions':
      return (
        <TransactionsScreen
          importState={importState}
          pendingLedgerRequest={pendingLedgerRequest}
          onConsumeLedgerRequest={consumeLedgerRequest}
        />
      )
    case 'categories':
      return <CategoriesScreen requestLedgerFilter={requestLedgerFilter} />
    case 'recurring':
      return <RecurringScreen />
  }
}

export default App
