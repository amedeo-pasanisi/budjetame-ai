import { useEffect, useMemo, useState } from 'react'

import {
  TOKEN_KEY,
  fetchWallets,
  formatSignedEuros,
  unfreezeWallet,
  type Wallet,
  type WalletType,
} from './api'
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
 * modal (issue #49), replacing the inline forms; the New wallet
 * button lives in the page header row like the Transactions tab. Frozen rows
 * keep their one-tap unfreeze. */
export function WalletsScreen() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalDraft | null>(null)
  const [frozenExpanded, setFrozenExpanded] = useState(false)
  const [unfreezeError, setUnfreezeError] = useState<string | null>(null)

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
  }, [token])

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
                    <button
                      type="button"
                      onClick={() => setModal({ kind: 'edit', wallet })}
                      className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
                    >
                      <span>
                        <span className="block font-medium text-slate-900">{wallet.name}</span>
                        <span className="block text-xs text-slate-500">
                          {TYPE_LABELS[wallet.type]}
                        </span>
                      </span>
                      <span className="font-semibold text-slate-900">
                        {formatSignedEuros(wallet.balance)}
                      </span>
                    </button>
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
                  <button
                    type="button"
                    onClick={() => handleUnfrozen(wallet)}
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
                  >
                    <span>
                      <span className="block font-medium text-slate-900">{wallet.name}</span>
                      <span className="block text-xs text-slate-500">
                        {TYPE_LABELS[wallet.type]} · Frozen
                      </span>
                    </span>
                    <span className="font-semibold text-slate-900">
                      {formatSignedEuros(wallet.balance)}
                    </span>
                  </button>
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
