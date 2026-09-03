import { useCallback, useEffect, useRef, useState } from 'react'

import {
  PAGE_LIMIT,
  exportTransactions,
  fetchCategories,
  fetchRecurringCosts,
  fetchRecurringIncomes,
  fetchTransactions,
  fetchWallets,
  formatEuros,
  TOKEN_KEY,
  ApiError,
  type Category,
  type RecurringCost,
  type RecurringIncome,
  type Transaction,
  type TransactionFilters,
  type Wallet,
} from './api'
import { useDataVersion, getDataVersion } from './api/dataVersion'
import type { LedgerFilterRequest } from './App'
import { CategoryModal } from './CategoryModal'
import { ImportScreen } from './ImportScreen'
import type { ImportDraftController } from './importDraft'
import { RecurringCostModal } from './RecurringCostModal'
import { RecurringIncomeModal } from './RecurringIncomeModal'
import { TransactionModal } from './TransactionModal'
import type { TransactionFormType, WalletTarget } from './transactionFields'
import { WalletModal } from './WalletModal'
import { signedAmount, hasLocation, transactionTitle } from './transactions'

const ALL_CATEGORIES = -1

/** The modal form's draft: create (no Transaction) or edit (a Transaction).
 * Null means the modal is closed (US8–US10). */
type FormDraft = { kind: 'create' } | { kind: 'edit'; transaction: Transaction }

/** The merged ledger (issue #33): the History tab's filters live in a
 * collapsible bar (closed by default) over the paged all-transactions list.
 * Any filter change refetches the first page with it applied; the bar, its
 * values, and the search persist across tab switches (the tab keeps-alive,
 * ADR-0022). The Import Draft (issue #43) is NOT screen state: it arrives
 * from the app shell, so it survives even a real unmount. The ledger jump
 * (issue #90) is shell state too — the pending Wallet/Category filter
 * request arrives with the panel's props and is consumed here exactly
 * once. */
export function TransactionsScreen({
  importState,
  pendingLedgerRequest,
  onConsumeLedgerRequest,
}: {
  importState: ImportDraftController
  /** The pending ledger jump (issue #90): a Wallet/Category row asked the
   * shell to open this ledger pre-filtered to that entity. Null while no
   * jump is pending. */
  pendingLedgerRequest: LedgerFilterRequest | null
  /** The consume side of the jump: call once the pending request has been
   * applied, so the shell clears it and no later render can reapply it. */
  onConsumeLedgerRequest: () => void
}) {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  // The link picker's costs (issue #57): an auxiliary fetch, so a recurring-
  // costs failure never takes down the ledger — the picker just shows no
  // costs until the next reload.
  const [recurringCosts, setRecurringCosts] = useState<RecurringCost[]>([])
  // The link picker's incomes (issue #61), the mirror of the costs fetch:
  // auxiliary and silent, same reasoning.
  const [recurringIncomes, setRecurringIncomes] = useState<RecurringIncome[]>([])
  const [transactions, setTransactions] = useState<Transaction[] | null>(null)
  // The accumulated list pages one at a time: the sentinel at the bottom of
  // the list (IntersectionObserver) fetches the next page while scrolling.
  // Null while the first page is still loading.
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState<FormDraft | null>(null)
  // Inline entity creation (ADR-0013): the inner Category create modal,
  // stacked on top of the transaction form's modal, and the new Category it
  // created — reported back to the open form so its field selects it. The
  // locked type is the form's current type at open time — Expense for an
  // Expense, Income for an Income — so the created Category is always valid
  // for the transaction being recorded. The Transfer form has no Category
  // field, so it never opens this.
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryModalType, setCategoryModalType] = useState<'expense' | 'income'>(
    'expense',
  )
  const [categoryToSelect, setCategoryToSelect] = useState<number | null>(null)
  // The inner Wallet create modal (ADR-0013), stacked on top of the
  // transaction form's modal, and the new Wallet it created — reported back
  // to the open form with the exact field whose sentinel was picked, so
  // that field selects it. The target doubles as the open flag (null =
  // closed) and, together with the form's current type, drives the
  // eligibility lock (ADR-0017): an Expense's 'wallet' field allows all
  // four types — the modal can create a Contact Wallet to record
  // consumption it paid for — while an Income's 'wallet' field stays
  // Checking/Credit Card/Cash, and a Transfer's From/To
  // ('source'/'destination') allow all four types, since Transfers are
  // where Contact Wallets belong.
  const [walletModalTarget, setWalletModalTarget] = useState<{
    target: WalletTarget
    type: TransactionFormType
  } | null>(null)
  const [walletToSelect, setWalletToSelect] = useState<{
    id: number
    target: WalletTarget
  } | null>(null)
  // Inline entity creation (ADR-0013): the inner Recurring Cost create
  // modal, stacked on top of the transaction form's modal (depth 2 of the
  // chain: transaction → recurring cost), and the new definition it created
  // — reported back to the open form so its Recurring Cost field selects
  // it, which per the linking contract immediately pays the new cost's
  // oldest Unpaid Occurrence (due today for a fresh definition with no
  // start date).
  const [recurringCostModalOpen, setRecurringCostModalOpen] = useState(false)
  const [recurringCostToSelect, setRecurringCostToSelect] = useState<number | null>(null)
  // The Recurring Income create modal, the mirror of the cost one (issue
  // #61): same contract, reported back to the Recurring Income field.
  const [recurringIncomeModalOpen, setRecurringIncomeModalOpen] = useState(false)
  const [recurringIncomeToSelect, setRecurringIncomeToSelect] = useState<number | null>(null)
  const [savedWarning, setSavedWarning] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // True only when the unfiltered, unsearched ledger is empty (issue #54):
  // then the search bar hides — there is nothing to search.
  const [ledgerEmpty, setLedgerEmpty] = useState(false)

  // Filters bar (issue #33): closed by default; every change refetches the
  // first page. Empty wallet/date/category values mean "all" (the tab keeps
  // its role as the full ledger). The wallet and category seeds read the
  // pending ledger jump (issue #90): the panel can mount because a Wallet
  // or Category row fired the jump, and the very first fetch must already
  // carry that filter — initial state applies it, never an
  // apply-then-refetch. The jump's other resets (dates, recurring, search,
  // the bar itself) are the fresh-mount defaults anyway.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterWalletId, setFilterWalletId] = useState<number | undefined>(
    () =>
      pendingLedgerRequest !== null && pendingLedgerRequest.kind === 'wallet'
        ? pendingLedgerRequest.id
        : undefined,
  )
  const [filterFromDate, setFilterFromDate] = useState('')
  const [filterToDate, setFilterToDate] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState<number>(() =>
    pendingLedgerRequest !== null && pendingLedgerRequest.kind === 'category'
      ? pendingLedgerRequest.id
      : ALL_CATEGORIES,
  )
  // The Recurring definition filter (issue #86): one select listing every
  // created Recurring Cost and Recurring Income (grouped — names may
  // collide across kinds); picking one narrows the ledger to the
  // Transactions linked to exactly that definition. The options come from
  // the link picker's auxiliary fetches, so the filter costs no extra
  // request. Undefined = all.
  const [filterRecurring, setFilterRecurring] = useState<
    { kind: 'cost' | 'income'; id: number } | undefined
  >(undefined)

  // Search (issue #54, ADR-0009): the input updates instantly; the request
  // needle is trimmed and debounced ~300ms, then refetches the first page
  // like any filter. It lives in the screen, so it survives tab switches
  // (keep-alive, ADR-0022) and resets only on app load.
  const [search, setSearch] = useState('')
  const [searchNeedle, setSearchNeedle] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchNeedle(search.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // The ledger jump (issue #90), while-mounted side: a Wallet/Category row
  // on another tab asked for this ledger pre-filtered to that entity. The
  // request REPLACES the whole filter state — wallet, category, from/to
  // dates, and the recurring filter all reset — clears the search (input
  // and debounced needle together, so no late debounce can resurrect it),
  // closes the Filters bar, and then rides the existing filter-change
  // reload: the first page refetches once with the new state. First mounts
  // need none of these updates (the seeds above already applied the
  // request); they still consume it, exactly once, here. Consuming in the
  // same tick the request arrives is what makes it safe: the shell's
  // pending is null on every later render, so a stale request can never
  // reapply. An open Import Draft changes nothing — the filter applies
  // underneath the Import screen, and the user exits the draft to find the
  // ledger already filtered (nothing waits on the draft's lifecycle).
  useEffect(() => {
    if (pendingLedgerRequest === null) {
      return
    }
    setFilterWalletId(
      pendingLedgerRequest.kind === 'wallet' ? pendingLedgerRequest.id : undefined,
    )
    setFilterCategoryId(
      pendingLedgerRequest.kind === 'category'
        ? pendingLedgerRequest.id
        : ALL_CATEGORIES,
    )
    setFilterFromDate('')
    setFilterToDate('')
    setFilterRecurring(undefined)
    setSearch('')
    setSearchNeedle('')
    setFiltersOpen(false)
    onConsumeLedgerRequest()
  }, [pendingLedgerRequest, onConsumeLedgerRequest])

  const filters = useCallback((): TransactionFilters => {
    const result: TransactionFilters = {}
    if (filterWalletId !== undefined) result.walletId = filterWalletId
    if (filterCategoryId !== ALL_CATEGORIES) result.categoryId = filterCategoryId
    if (filterFromDate !== '') result.fromDate = filterFromDate
    if (filterToDate !== '') result.toDate = filterToDate
    if (filterRecurring !== undefined) {
      if (filterRecurring.kind === 'cost') {
        result.recurringCostId = filterRecurring.id
      } else {
        result.recurringIncomeId = filterRecurring.id
      }
    }
    return result
  }, [filterWalletId, filterCategoryId, filterFromDate, filterToDate, filterRecurring])

  // The Filters bar and the search compose into one request (ADR-0009): the
  // client omits a blank q, so a cleared search refetches the filtered list.
  const requestFilters = useCallback((): TransactionFilters => {
    const result = filters()
    if (searchNeedle !== '') result.q = searchNeedle
    return result
  }, [filters, searchNeedle])

  const filtersActive = Object.keys(filters()).length > 0

  // Generation counter: any write (save/delete/import) or filter change
  // resets the list to the first page; a further page still in flight when
  // that happens must not append its pre-reset rows.
  const generation = useRef(0)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  // The cache clock (ADR-0022) and the version the last write's explicit
  // reload() covered: the effect below skips a reload when this screen's
  // own write already reloaded explicitly (save/delete/import-done), so
  // one write never fetches the ledger twice. Filter and search changes
  // always reload — the version did not change then.
  const dataVersion = useDataVersion()
  const lastWriteReloadVersion = useRef(-1)
  // The version the effect last saw, so a bump is told apart from a filter
  // change (which re-runs the effect through `reload`'s identity).
  const lastSeenVersion = useRef(-1)

  const reload = useCallback(() => {
    // The bump is synchronous inside the awaited write, so this records the
    // fresh version — the effect then knows this write is already covered.
    lastWriteReloadVersion.current = getDataVersion()
    generation.current += 1
    setLoadError(null)
    const active = requestFilters()
    // Frozen Wallets are included (issue #33): the Wallet filter lists them
    // and their rows stay viewable but read-only.
    Promise.all([
      fetchWallets(token, true),
      fetchCategories(token),
      fetchTransactions(token, active),
    ])
      .then(([walletData, categoryData, page]) => {
        setWallets(walletData)
        setCategories(categoryData)
        setTransactions(page.items)
        setNextCursor(page.next_cursor)
        // The unfiltered, unsearched fetch is the truth about the ledger:
        // only when it returns nothing is the ledger truly empty (and the
        // search bar hidden — nothing to search).
        if (Object.keys(active).length === 0) {
          setLedgerEmpty(page.items.length === 0)
        }
      })
      .catch(() => setLoadError('Could not load your data.'))
    // The picker's "which Occurrence will this link pay" depends on the
    // current links, so the costs refetch on every reload (any save or
    // delete changes them). Failure is silent: the ledger still loads.
    fetchRecurringCosts(token)
      .then((data) => setRecurringCosts(data))
      .catch(() => {})
    // The incomes refetch for the same reason (issue #61).
    fetchRecurringIncomes(token)
      .then((data) => setRecurringIncomes(data))
      .catch(() => {})
  }, [token, requestFilters])

  // Any filter change — or a write anywhere (dataVersion bump, ADR-0022) —
  // refetches with it applied and resets to the first page. A bump that
  // this screen's own explicit reload() already covered is skipped.
  useEffect(() => {
    if (dataVersion !== lastSeenVersion.current) {
      lastSeenVersion.current = dataVersion
      if (lastWriteReloadVersion.current === dataVersion) {
        return
      }
    }
    reload()
  }, [reload, dataVersion])

  const loadMore = () => {
    if (nextCursor === null || loadingMore) {
      return
    }
    const gen = generation.current
    setLoadingMore(true)
    fetchTransactions(token, requestFilters(), PAGE_LIMIT, nextCursor)
      .then((page) => {
        if (gen !== generation.current) {
          return
        }
        setTransactions((current) => {
          if (current === null) {
            return page.items
          }
          // The backend's keyset cursor never returns overlapping pages; the
          // id-set is a defensive guard (StrictMode double-effects, stale
          // responses).
          const seen = new Set(current.map((transaction) => transaction.id))
          return [
            ...current,
            ...page.items.filter((transaction) => !seen.has(transaction.id)),
          ]
        })
        setNextCursor(page.next_cursor)
      })
      .catch(() => {
        if (gen === generation.current) {
          setLoadError('Could not load more transactions.')
        }
      })
      .finally(() => setLoadingMore(false))
  }

  // The observer callback must see the latest loadMore without re-observing
  // on every render; the effect re-runs only when the page boundary changes
  // (a re-observe fires the initial callback again, which auto-fills when the
  // sentinel is still visible). A failed loadMore never auto-retries: the
  // sentinel only re-fires on a real intersection change.
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  useEffect(() => {
    const node = sentinelRef.current
    if (node === null || nextCursor === null) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreRef.current()
        }
      },
      // Fetch before the sentinel reaches the viewport edge.
      { rootMargin: '300px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [nextCursor])

  const selectedWallet = wallets?.find((w) => w.id === filterWalletId)

  const walletName = (walletId: number | null): string =>
    walletId === null
      ? 'Frozen wallet'
      : (wallets?.find((w) => w.id === walletId)?.name ?? 'Frozen wallet')

  const categoryName = (categoryId: number | null): string | null => {
    if (categoryId === null) return null
    return categories?.find((c) => c.id === categoryId)?.name ?? null
  }

  // Frozen-Wallet Transactions are viewable but not editable/deletable
  // (ADR-0002). A Transfer is frozen when either leg is frozen — a Wallet can
  // freeze after the Transfer exists, so the check must cover both legs.
  const onFrozenWallet = (transaction: Transaction): boolean => {
    if (transaction.type === 'transfer') {
      const source = wallets?.find((w) => w.id === transaction.source_wallet_id)
      const destination = wallets?.find(
        (w) => w.id === transaction.destination_wallet_id,
      )
      return (
        source === undefined ||
        source.frozen ||
        destination === undefined ||
        destination.frozen
      )
    }
    const wallet = wallets?.find((w) => w.id === transaction.wallet_id)
    return wallet === undefined || wallet.frozen
  }

  // The list-append shared by both inline-creation hosts — the transaction
  // form and the import row editor (ADR-0013/0014): a created entity joins
  // the list state so every dropdown offers it again without a reload.
  const addWalletToList = (wallet: Wallet) => {
    setWallets((current) => (current === null ? [wallet] : [...current, wallet]))
  }
  const addCategoryToList = (category: Category) => {
    setCategories((current) => (current === null ? [category] : [...current, category]))
  }

  // The inner Category modal's save (ADR-0013): add the Category to the
  // list state (so the dropdown offers it again without a reload), close
  // only the inner modal, and report the new id to the open form so the
  // originating field selects it — the transaction form's Category field.
  // The form's draft is untouched.
  const handleCategoryCreated = (category: Category) => {
    addCategoryToList(category)
    setCategoryToSelect(category.id)
    setCategoryModalOpen(false)
  }

  // The inner Wallet modal's save (ADR-0013): add the Wallet to the list
  // state (so the dropdown offers it again without a reload), close only
  // the inner modal, and report the new id to the open form so the
  // originating field selects it — the transaction form's exact field whose
  // sentinel was picked. The form's draft is untouched.
  const handleWalletCreated = (wallet: Wallet) => {
    addWalletToList(wallet)
    if (walletModalTarget !== null) {
      setWalletToSelect({ id: wallet.id, target: walletModalTarget.target })
    }
    setWalletModalTarget(null)
  }

  // The inner Recurring Cost modal's save (ADR-0013): add the definition to
  // the list state (so the dropdown offers it again without a reload), close
  // only that modal, and report the new id to the open transaction form so
  // its Recurring Cost field selects it — which per the linking contract
  // immediately links the transaction and pays the new cost's oldest Unpaid
  // Occurrence. The form's draft is untouched.
  const handleRecurringCostCreated = (cost: RecurringCost) => {
    setRecurringCosts((current) => [...current, cost])
    setRecurringCostToSelect(cost.id)
    setRecurringCostModalOpen(false)
  }

  // The inner Recurring Income modal's save, the mirror of the cost one
  // (issue #61): same contract, reported back to the Recurring Income field.
  const handleRecurringIncomeCreated = (income: RecurringIncome) => {
    setRecurringIncomes((current) => [...current, income])
    setRecurringIncomeToSelect(income.id)
    setRecurringIncomeModalOpen(false)
  }

  // Closing the transaction form also clears the pending auto-selects: a
  // stale id must not be re-applied when the form opens again later — the
  // transaction form's fields and the stacked recurring modals' fields.
  const closeForm = () => {
    setForm(null)
    setCategoryToSelect(null)
    setWalletToSelect(null)
    setRecurringCostToSelect(null)
    setRecurringIncomeToSelect(null)
  }

  const handleSaved = (transaction: Transaction) => {
    closeForm()
    // The dataVersion effect also reloads after this render (ADR-0022); the
    // banner must survive that background reload, so reload never clears it
    // — each write sets or clears it itself ("last write wins").
    reload()
    setSavedWarning(transaction.warning ? 'Saved — this made a Cash wallet negative.' : null)
  }

  const handleDeleted = (warning: boolean) => {
    closeForm()
    reload()
    setSavedWarning(warning ? 'Deleted — this made a Cash wallet negative.' : null)
  }

  // Export (US 7.3): the ledger exactly as the filters show it — every
  // matching row, not just the visible page — downloads as the import
  // template's .xlsx under the server's dated filename. The browser anchor
  // trick is the standard no-navigation download; the object URL lives only
  // for the click and is revoked right after.
  const handleExport = async () => {
    setExportError(null)
    try {
      const { blob, filename } = await exportTransactions(token, requestFilters())
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setExportError(
        error instanceof ApiError ? error.message : 'Could not export transactions',
      )
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Transactions</h2>
        {importState.draft === null && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm({ kind: 'create' })}
              disabled={wallets === null || categories === null}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              New transaction
            </button>
            <button
              type="button"
              onClick={importState.open}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600"
            >
              Import
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600"
            >
              Export
            </button>
          </div>
        )}
      </div>

      {importState.draft !== null ? (
        <ImportScreen
          controller={importState}
          wallets={wallets}
          categories={categories}
          onWalletCreated={addWalletToList}
          onCategoryCreated={addCategoryToList}
          onDone={() => {
            importState.done()
            reload()
          }}
        />
      ) : (
        <>
          {loadError !== null && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
          {exportError !== null && (
            <p className="mt-2 text-sm text-red-600">{exportError}</p>
          )}
          {savedWarning !== null && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {savedWarning}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-700">All transactions</h3>
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600"
            >
              Filters {filtersOpen ? '▾' : '▸'}
            </button>
          </div>

          {!ledgerEmpty && (
            <div className="mt-3">
              <input
                aria-label="Search transactions"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search transactions…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}

          {filtersOpen && (
            <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <label htmlFor="filters-wallet" className="block text-sm font-medium text-slate-700">
                  Wallet
                </label>
                <select
                  id="filters-wallet"
                  value={filterWalletId ?? ''}
                  onChange={(event) =>
                    setFilterWalletId(
                      event.target.value === '' ? undefined : Number(event.target.value),
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">All wallets</option>
                  {wallets?.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                      {wallet.frozen ? ' · Frozen' : ''} ({formatEuros(wallet.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="filters-from" className="block text-sm font-medium text-slate-700">
                    From
                  </label>
                  <input
                    id="filters-from"
                    type="date"
                    value={filterFromDate}
                    onChange={(event) => setFilterFromDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="filters-to" className="block text-sm font-medium text-slate-700">
                    To
                  </label>
                  <input
                    id="filters-to"
                    type="date"
                    value={filterToDate}
                    onChange={(event) => setFilterToDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="filters-recurring" className="block text-sm font-medium text-slate-700">
                  Recurring
                </label>
                <select
                  id="filters-recurring"
                  value={
                    filterRecurring === undefined
                      ? ''
                      : `${filterRecurring.kind}:${filterRecurring.id}`
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === '') {
                      setFilterRecurring(undefined)
                      return
                    }
                    const [kind, id] = value.split(':')
                    setFilterRecurring({ kind: kind as 'cost' | 'income', id: Number(id) })
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">All transactions</option>
                  <optgroup label="Recurring costs">
                    {recurringCosts.map((cost) => (
                      <option key={cost.id} value={`cost:${cost.id}`}>
                        {cost.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Recurring incomes">
                    {recurringIncomes.map((income) => (
                      <option key={income.id} value={`income:${income.id}`}>
                        {income.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div>
                <label htmlFor="filters-category" className="block text-sm font-medium text-slate-700">
                  Category
                </label>
                <select
                  id="filters-category"
                  value={filterCategoryId}
                  onChange={(event) => setFilterCategoryId(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value={ALL_CATEGORIES}>All categories</option>
                  {categories?.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.icon !== null ? `${category.icon} ` : ''}
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {selectedWallet?.frozen && (
            <p className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              This wallet is frozen — its history is viewable but read-only.
            </p>
          )}

          {wallets === null || categories === null || transactions === null ? (
            <p className="mt-3 text-sm text-slate-500">Loading…</p>
          ) : transactions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              {searchNeedle !== ''
                ? 'No transactions match your search.'
                : filtersActive
                  ? 'No transactions match these filters.'
                  : 'Nothing here yet.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {transactions.map((transaction) => {
                const editable =
                  transaction.type !== 'opening_balance' &&
                  !onFrozenWallet(transaction)
                const category = categoryName(transaction.category_id)
                const walletLabel =
                  transaction.type === 'transfer'
                    ? `${walletName(transaction.source_wallet_id)} → ${walletName(
                        transaction.destination_wallet_id,
                      )}`
                    : walletName(transaction.wallet_id)
                return (
                  <li key={transaction.id}>
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() => setForm({ kind: 'edit', transaction })}
                      className={`flex w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm ${
                        editable ? '' : 'opacity-70'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {transactionTitle(transaction, category)}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {transaction.date} · {walletLabel}
                          {hasLocation(transaction) && ' · 📍'}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-slate-900">
                        {signedAmount(transaction)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {nextCursor !== null && (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-3 text-xs text-slate-500"
            >
              {loadingMore ? 'Loading more…' : ''}
            </div>
          )}
        </>
      )}

      {form !== null && wallets !== null && categories !== null && (
        <TransactionModal
          wallets={wallets}
          categories={categories}
          recurringCosts={recurringCosts}
          recurringIncomes={recurringIncomes}
          editing={form.kind === 'edit' ? form.transaction : null}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={closeForm}
          onAddCategory={(type) => {
            setCategoryModalType(type)
            setCategoryModalOpen(true)
          }}
          categoryToSelect={categoryToSelect}
          onAddWallet={(target, type) => {
            setWalletModalTarget({ target, type })
          }}
          walletToSelect={walletToSelect}
          onAddRecurringCost={() => setRecurringCostModalOpen(true)}
          recurringCostToSelect={recurringCostToSelect}
          onAddRecurringIncome={() => setRecurringIncomeModalOpen(true)}
          recurringIncomeToSelect={recurringIncomeToSelect}
        />
      )}

      {recurringCostModalOpen && (
        <RecurringCostModal
          onSaved={handleRecurringCostCreated}
          onClose={() => setRecurringCostModalOpen(false)}
        />
      )}

      {recurringIncomeModalOpen && (
        <RecurringIncomeModal
          onSaved={handleRecurringIncomeCreated}
          onClose={() => setRecurringIncomeModalOpen(false)}
        />
      )}

      {categoryModalOpen && (
        <CategoryModal
          lockedType={categoryModalType}
          onSaved={handleCategoryCreated}
          onClose={() => setCategoryModalOpen(false)}
        />
      )}

      {walletModalTarget !== null && (
        <WalletModal
          allowedTypes={
            walletModalTarget.target === 'wallet'
              ? // ADR-0017: an Expense may record consumption a Contact
                // paid for — all four types; an Income never may.
                walletModalTarget.type === 'expense'
                ? undefined
                : ['checking', 'credit_card', 'cash']
              : undefined
          }
          onSaved={handleWalletCreated}
          onClose={() => {
            // A cancelled wallet modal forgets where it was opened from: a
            // later pick from another form must not inherit the stale
            // routing.
            setWalletModalTarget(null)
          }}
        />
      )}
    </>
  )
}
