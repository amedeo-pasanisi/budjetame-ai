import { useEffect, useMemo, useState } from 'react'

import type { LedgerFilterRequest } from './App'
import {
  TOKEN_KEY,
  fetchWallets,
  formatSignedEuros,
  unfreezeWallet,
  type Wallet,
  type WalletType,
} from './api'
import { useDataVersion } from './api/dataVersion'
import { WalletModal } from './WalletModal'

const TYPE_LABELS: Record<WalletType, string> = {
  checking: 'Checking',
  credit_card: 'Credit Card',
  cash: 'Cash',
  contact: 'Contact',
}

// Section headers are plural, like the Categories tab's Expenses/Incomes;
// "Cash" has no English plural. Row subtitles keep the singular labels above.
const SECTION_LABELS: Record<WalletType, string> = {
  contact: 'Contacts',
  checking: 'Checking Accounts',
  credit_card: 'Credit Cards',
  cash: 'Cash',
}

// Fixed order: Contacts first, so who owes me / whom do I owe is answered the
// moment the tab opens (issue #47).
const SECTION_TYPES: WalletType[] = ['contact', 'checking', 'credit_card', 'cash']

/** The modal's draft: create (no Wallet) or edit (a Wallet). Null means the
 * modal is closed. Create and edit share the one modal, like the
 * Categories tab (issue #49). */
type ModalDraft = { kind: 'create' } | { kind: 'edit'; wallet: Wallet }

/** The Wallets tab: the list is four sections — Contacts, Checking Accounts,
 * Credit Cards, Cash — each sorted A→Z case-insensitively, plus a collapsed
 * Frozen Wallets list. Creating and editing (rename, freeze) happen in a
 * modal (issue #49); the New wallet button lives in the page header row
 * like the Transactions tab.
 *
 * Row structure (issue #93): a row is a main tap surface with sibling
 * trailing buttons inside one card — nested buttons are illegal. The tap
 * surface (content + balance, on active AND frozen rows) sends the ledger
 * jump (issue #90): the shell opens the Transactions tab pre-filtered to
 * that Wallet, and a frozen Wallet arrives with the read-only banner
 * already showing. The trailing buttons are the row's actions: ✎ Edit
 * opens the edit modal (rename/freeze — renaming works on frozen rows
 * too), and frozen rows add one-tap Unfreeze; the old whole-row edit and
 * whole-row unfreeze semantics moved here. */
export function WalletsScreen({
  requestLedgerFilter,
}: {
  /** Send a ledger jump (issue #90): open the Transactions tab with the
   * ledger pre-filtered to one Wallet. Fired by the whole-row tap surface
   * (issue #93). */
  requestLedgerFilter?: (request: LedgerFilterRequest) => void
}) {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  const [frozenExpanded, setFrozenExpanded] = useState(false)
  const [unfreezeError, setUnfreezeError] = useState<string | null>(null)
  // The cache clock (ADR-0022): a write anywhere re-fetches this list in
  // the background, so the tab is never stale when switched back to.
  const dataVersion = useDataVersion()

  useEffect(() => {
    let cancelled = false
    // Frozen Wallets come along for the collapsed Frozen Wallets list (#48).
    fetchWallets(token, true)
      .then((data) => {
        if (!cancelled) setWallets(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load your wallets.')
      })
    return () => {
      cancelled = true
    }
  }, [token, dataVersion])

  // Create and edit share one save path: upsert the saved Wallet and close
  // the modal.
  const handleSaved = (wallet: Wallet) => {
    setWallets((current) => {
      if (current === null) {
        return [wallet]
      }
      return current.some((existing) => existing.id === wallet.id)
        ? current.map((existing) => (existing.id === wallet.id ? wallet : existing))
        : [...current, wallet]
    })
    setModal(null)
  }

  const handleFrozen = (walletId: number) => {
    // The Wallet stays in state, flipping to frozen: it moves from its type
    // section into the Frozen Wallets list (issue #48).
    setWallets((current) =>
      current === null
        ? current
        : current.map((existing) =>
            existing.id === walletId ? { ...existing, frozen: true } : existing,
          ),
    )
    setModal(null)
  }

  const handleUnfrozen = async (wallet: Wallet) => {
    setUnfreezeError(null)
    try {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const unfrozen = await unfreezeWallet(token, wallet.id)
      setWallets((current) =>
        current === null
          ? current
          : current.map((existing) => (existing.id === unfrozen.id ? unfrozen : existing)),
      )
    } catch {
      setUnfreezeError('Could not unfreeze the wallet.')
    }
  }

  // The sections are derived at render time: group by type in the fixed
  // order and sort A→Z case-insensitively, so a new or renamed Wallet lands
  // at the sorted position of its section (issue #47). Frozen Wallets live in
  // the separate Frozen Wallets list, never in the type sections (#48).
  const sections = useMemo(() => {
    if (wallets === null) {
      return null
    }
    return SECTION_TYPES.map((type) => ({
      type,
      label: SECTION_LABELS[type],
      items: wallets
        .filter((wallet) => wallet.type === type && !wallet.frozen)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    }))
  }, [wallets])

  // One flat A→Z list across types, matching the active sections' sort (#48).
  const frozenWallets = useMemo(() => {
    if (wallets === null) {
      return []
    }
    return wallets
      .filter((wallet) => wallet.frozen)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [wallets])

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Wallets</h2>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          New wallet
        </button>
      </div>

      {loadError !== null && <p className="mb-4 mt-2 text-sm text-red-600">{loadError}</p>}

      {wallets === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading wallets…</p>
      ) : wallets.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No wallets yet. Add your first one to start tracking.
        </p>
      ) : (
        sections
          ?.filter((section) => section.items.length > 0)
          .map((section) => (
            <section
              key={section.type}
              aria-labelledby={`wallets-${section.type}`}
              className="mt-5"
            >
              <h3
                id={`wallets-${section.type}`}
                className="text-sm font-medium text-slate-700"
              >
                {section.label}
              </h3>
              <ul className="mt-2 space-y-3">
                {section.items.map((wallet) => (
                  <li key={wallet.id}>
                    {/* A row is a tap surface plus sibling trailing buttons
                        (issue #93): the card holds the surface and the ✎
                        side by side — nested buttons are illegal. The whole
                        surface (content + balance) is the ledger jump. */}
                    <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <button
                        type="button"
                        onClick={() =>
                          requestLedgerFilter?.({ kind: 'wallet', id: wallet.id })
                        }
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 pr-2 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900">
                            {wallet.name}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {TYPE_LABELS[wallet.type]}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold text-slate-900">
                          {formatSignedEuros(wallet.balance)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Edit ${wallet.name}`}
                        onClick={() => setModal({ kind: 'edit', wallet })}
                        className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
                      >
                        ✎
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}

      {frozenWallets.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={frozenExpanded}
            onClick={() => setFrozenExpanded((open) => !open)}
            className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-600"
          >
            Frozen wallets ({frozenWallets.length})
          </button>
          {frozenExpanded && (
            <ul className="mt-2 space-y-3">
              {frozenWallets.map((wallet) => (
                <li key={wallet.id}>
                  {/* A frozen row is the same tap surface + trailing buttons
                      (issue #93): the surface jumps to the read-only ledger,
                      Unfreeze and ✎ Edit are its sibling actions. */}
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() =>
                        requestLedgerFilter?.({ kind: 'wallet', id: wallet.id })
                      }
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 pl-4 pr-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">
                          {wallet.name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {TYPE_LABELS[wallet.type]} · Frozen
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-slate-900">
                        {formatSignedEuros(wallet.balance)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUnfrozen(wallet)}
                      className="h-9 shrink-0 px-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      Unfreeze
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${wallet.name}`}
                      onClick={() => setModal({ kind: 'edit', wallet })}
                      className="mr-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-slate-400 hover:text-slate-700"
                    >
                      ✎
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {unfreezeError !== null && (
            <p className="mt-2 text-sm text-red-600">{unfreezeError}</p>
          )}
        </div>
      )}

      {modal !== null && (
        <WalletModal
          wallet={modal.kind === 'edit' ? modal.wallet : undefined}
          onSaved={handleSaved}
          onFrozen={handleFrozen}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
