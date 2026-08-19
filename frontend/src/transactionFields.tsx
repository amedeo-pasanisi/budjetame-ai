/** The Transaction form's type-cascade forks (issue #17).

 * The Expense/Income/Transfer cascade forks in exactly four places: which
 * Wallets a Transaction moves money between, how the projected balance reads,
 * whether a Category applies, and the type picker at the root. Each branch
 * lives here as a small presentational component; TransactionForm keeps the
 * state, the handlers and the shared layout (amount/date, description,
 * location, actions). Nothing here changes what is rendered — it is the same
 * JSX, moved.
 */

import type { Category, RecurringCost, Wallet } from './api'
import { formatEuros } from './api'
import type { TransferProjection } from './balanceProjection'
import { NON_CONTACT_WALLET_TYPES } from './transactions'

export type TransactionFormType = 'expense' | 'income' | 'transfer'

export function TypeSelector({
  active,
  disabled,
  onSelect,
}: {
  active: TransactionFormType
  disabled: boolean
  onSelect: (type: TransactionFormType) => void
}) {
  return (
    <div className="flex gap-2">
      {(['expense', 'income', 'transfer'] as const).map((type) => (
        <button
          key={type}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(type)}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium ${
            active === type ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
          } disabled:opacity-60`}
        >
          {type === 'expense' ? 'Expense' : type === 'income' ? 'Income' : 'Transfer'}
        </button>
      ))}
    </div>
  )
}

/** The single-Wallet select an Expense or Income moves money through. */
export function WalletField({
  wallets,
  value,
  disabled,
  onChange,
}: {
  wallets: Wallet[]
  value: number | undefined
  disabled: boolean
  onChange: (walletId: number) => void
}) {
  const spendableWallets = wallets.filter((wallet) =>
    NON_CONTACT_WALLET_TYPES.includes(wallet.type),
  )
  return (
    <div>
      <label htmlFor="tx-wallet" className="block text-sm font-medium text-slate-700">
        Wallet
      </label>
      <select
        id="tx-wallet"
        required
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
      >
        {spendableWallets.length === 0 && <option value="">No spendable wallets</option>}
        {spendableWallets.map((wallet) => (
          <option key={wallet.id} value={wallet.id}>
            {wallet.name} ({formatEuros(wallet.balance)})
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">
        Contact wallets only move money through transfers.
      </p>
    </div>
  )
}

/** The From/To Wallet selects a Transfer moves money between. */
export function TransferWalletFields({
  wallets,
  sourceWalletId,
  destinationWalletId,
  disabled,
  onSourceChange,
  onDestinationChange,
}: {
  wallets: Wallet[]
  sourceWalletId: number | undefined
  destinationWalletId: number | undefined
  disabled: boolean
  onSourceChange: (walletId: number) => void
  onDestinationChange: (walletId: number) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <WalletSelect
        id="tx-source"
        label="From"
        wallets={wallets}
        value={sourceWalletId}
        disabled={disabled}
        onChange={onSourceChange}
      />
      <WalletSelect
        id="tx-destination"
        label="To"
        wallets={wallets}
        value={destinationWalletId}
        disabled={disabled}
        onChange={onDestinationChange}
      />
    </div>
  )
}

/** The Category select an Expense or Income carries (Transfers never do). */
export function CategoryField({
  categories,
  type,
  value,
  onChange,
}: {
  categories: Category[]
  type: 'expense' | 'income'
  value: number | null
  onChange: (categoryId: number | null) => void
}) {
  const matchingCategories = categories.filter((category) => category.type === type)
  return (
    <div>
      <label htmlFor="tx-category" className="block text-sm font-medium text-slate-700">
        Category
      </label>
      <select
        id="tx-category"
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
      >
        <option value="">None</option>
        {matchingCategories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.icon !== null ? `${category.icon} ` : ''}
            {category.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The Recurring Cost select an Expense carries (issue #57): Expenses only —
 * Income and Transfer never render it. Picking a cost signs it as paid, and
 * the helper names the Occurrence the link will pay: `occurrenceDate` is the
 * oldest Unpaid Occurrence's own date for a new link, or the stored pin when
 * the form is editing the very link already on the Transaction (which must
 * never be reassigned by a mere date edit). The None option unlinks. */
export function RecurringCostField({
  costs,
  value,
  occurrenceDate,
  onChange,
}: {
  costs: RecurringCost[]
  value: number | null
  occurrenceDate: string | null
  onChange: (costId: number | null) => void
}) {
  return (
    <div>
      <label htmlFor="tx-recurring-cost" className="block text-sm font-medium text-slate-700">
        Recurring Cost
      </label>
      <select
        id="tx-recurring-cost"
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none"
      >
        <option value="">None</option>
        {costs.map((cost) => (
          <option key={cost.id} value={cost.id}>
            {cost.name}
          </option>
        ))}
      </select>
      {value !== null && occurrenceDate !== null && (
        <p className="mt-1 text-xs text-slate-500">
          Pays the occurrence of {occurrenceDate}.
        </p>
      )}
    </div>
  )
}

/** The projected balance of the one Wallet an Expense/Income moves. */
export function WalletBalancePreview({
  wallet,
  before,
  after,
  willWarn,
}: {
  wallet: Wallet
  before: number
  after: number
  willWarn: boolean
}) {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      {wallet.name}: {formatEuros(before.toFixed(2))} →{' '}
      <span className="font-semibold">{formatEuros(after.toFixed(2))}</span>
      {willWarn && (
        <span className="mt-1 block text-amber-700">
          ⚠ This will make your Cash wallet negative.
        </span>
      )}
    </p>
  )
}

/** The projected balances of both Wallets a Transfer moves between. */
export function TransferBalancePreview({
  source,
  destination,
  projection,
  willWarn,
}: {
  source: Wallet
  destination: Wallet
  projection: TransferProjection
  willWarn: boolean
}) {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
      {source.name}: {formatEuros(projection.source.before.toFixed(2))} →{' '}
      <span className="font-semibold">
        {formatEuros(projection.source.after.toFixed(2))}
      </span>
      <span className="mx-1">·</span>
      {destination.name}: {formatEuros(projection.destination.before.toFixed(2))} →{' '}
      <span className="font-semibold">
        {formatEuros(projection.destination.after.toFixed(2))}
      </span>
      {willWarn && (
        <span className="mt-1 block text-amber-700">
          ⚠ This will make your Cash wallet negative.
        </span>
      )}
    </p>
  )
}

function WalletSelect({
  id,
  label,
  wallets,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  wallets: Wallet[]
  value: number | undefined
  disabled: boolean
  onChange: (walletId: number) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        required
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
      >
        {wallets.length === 0 && <option value="">No wallets yet</option>}
        {wallets.map((wallet) => (
          <option key={wallet.id} value={wallet.id}>
            {wallet.name} ({formatEuros(wallet.balance)})
          </option>
        ))}
      </select>
    </div>
  )
}
