/** The Transaction form's type-cascade forks (issue #17).

 * The Expense/Income/Transfer cascade forks in exactly four places: which
 * Wallets a Transaction moves money between, how the projected balance reads,
 * whether a Category applies, and the type picker at the root. Each branch
 * lives here as a small presentational component; TransactionForm keeps the
 * state, the handlers and the shared layout (amount/date, description,
 * location, actions). Nothing here changes what is rendered — it is the same
 * JSX, moved.
 */

import type { Category, RecurringCost, RecurringIncome, Wallet } from './api'
import { formatEuros } from './api'
import type { TransferProjection } from './balanceProjection'
import { EntitySelect } from './EntitySelect'
import { NON_CONTACT_WALLET_TYPES } from './transactions'

export type TransactionFormType = 'expense' | 'income' | 'transfer'

/** Which Wallet field a Transaction form's inline-create sentinel was
 * picked from (ADR-0013): 'wallet' for an Expense/Income's single Wallet
 * select, 'source' or 'destination' for a Transfer's From/To. The screen
 * reports the newly created Wallet back with this target, so the form
 * auto-selects it into the exact field — the only one that changes. */
export type WalletTarget = 'wallet' | 'source' | 'destination'

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

/** The single-Wallet select an Expense or Income moves money through, with
 * the inline "＋ Add wallet…" sentinel (ADR-0013): the shared EntitySelect
 * wrapper renders it always last and reverts the field on a sentinel pick;
 * the screen hosts the inner New wallet modal, restricted to Checking,
 * Credit Card, and Cash — Contact Wallets only move money via Transfers,
 * so they never appear here. */
export function WalletField({
  wallets,
  value,
  disabled,
  onChange,
  onAdd,
}: {
  wallets: Wallet[]
  value: number | undefined
  disabled: boolean
  onChange: (walletId: number) => void
  /** Opens the Wallet create modal, hosted by the screen. */
  onAdd: () => void
}) {
  const spendableWallets = wallets.filter((wallet) =>
    NON_CONTACT_WALLET_TYPES.includes(wallet.type),
  )
  return (
    <div>
      <EntitySelect
        id="tx-wallet"
        label="Wallet"
        required
        disabled={disabled}
        value={value ?? ''}
        onChange={(next) => {
          if (next !== '') onChange(next)
        }}
        options={spendableWallets.map((wallet) => ({
          id: wallet.id,
          label: `${wallet.name} (${formatEuros(wallet.balance)})`,
        }))}
        entity="wallet"
        onAdd={onAdd}
      />
      <p className="mt-1 text-xs text-slate-500">
        Contact wallets only move money through transfers.
      </p>
    </div>
  )
}

/** The From/To Wallet selects a Transfer moves money between. Each carries
 * the inline "＋ Add wallet…" sentinel (ADR-0013); picking one opens the
 * New wallet modal with all four types — including Contact — since
 * Transfers are where Contact Wallets belong. The screen reports the new
 * Wallet back with the exact field whose sentinel was picked, so only that
 * field auto-selects it. */
export function TransferWalletFields({
  wallets,
  sourceWalletId,
  destinationWalletId,
  disabled,
  onSourceChange,
  onDestinationChange,
  onAdd,
}: {
  wallets: Wallet[]
  sourceWalletId: number | undefined
  destinationWalletId: number | undefined
  disabled: boolean
  onSourceChange: (walletId: number) => void
  onDestinationChange: (walletId: number) => void
  /** Opens the Wallet create modal, hosted by the screen, with the field
   * whose sentinel was picked. */
  onAdd: (target: 'source' | 'destination') => void
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
        onAdd={() => onAdd('source')}
      />
      <WalletSelect
        id="tx-destination"
        label="To"
        wallets={wallets}
        value={destinationWalletId}
        disabled={disabled}
        onChange={onDestinationChange}
        onAdd={() => onAdd('destination')}
      />
    </div>
  )
}

/** The Category select an Expense or Income carries (Transfers never do),
 * with the inline "＋ Add category…" sentinel (ADR-0013): the shared
 * EntitySelect wrapper renders it always last, after None, and reverts the
 * field on a sentinel pick; the screen hosts the inner New category modal,
 * locked to this field's type (Expense for an Expense, Income for an
 * Income). */
export function CategoryField({
  categories,
  type,
  value,
  onChange,
  onAdd,
}: {
  categories: Category[]
  type: 'expense' | 'income'
  value: number | null
  onChange: (categoryId: number | null) => void
  /** Opens the Category create modal, hosted by the screen. */
  onAdd: () => void
}) {
  const matchingCategories = categories.filter((category) => category.type === type)
  return (
    <EntitySelect
      id="tx-category"
      label="Category"
      value={value ?? ''}
      onChange={(categoryId) => onChange(categoryId === '' ? null : categoryId)}
      options={matchingCategories.map((category) => ({
        id: category.id,
        label: category.icon !== null ? `${category.icon} ${category.name}` : category.name,
      }))}
      entity="category"
      onAdd={onAdd}
    />
  )
}

/** The Recurring Cost select an Expense carries (issue #57): Expenses only —
 * Income and Transfer never render it. Picking a cost signs it as paid, and
 * the helper names the Occurrence the link will pay: `occurrenceDate` is the
 * oldest Unpaid Occurrence's own date for a new link, or the stored pin when
 * the form is editing the very link already on the Transaction (which must
 * never be reassigned by a mere date edit). The None option unlinks. The
 * select carries the inline "＋ Add recurring cost…" sentinel (ADR-0013),
 * like the Category and Wallet fields: picking it opens the Recurring Cost
 * create modal hosted by the screen, which reports the new definition back
 * for auto-selection. */
export function RecurringCostField({
  costs,
  value,
  occurrenceDate,
  onChange,
  onAdd,
}: {
  costs: RecurringCost[]
  value: number | null
  occurrenceDate: string | null
  onChange: (costId: number | null) => void
  /** Opens the Recurring Cost create modal, hosted by the screen. */
  onAdd: () => void
}) {
  return (
    <div>
      <EntitySelect
        id="tx-recurring-cost"
        label="Recurring Cost"
        value={value ?? ''}
        onChange={(costId) => onChange(costId === '' ? null : costId)}
        options={costs.map((cost) => ({ id: cost.id, label: cost.name }))}
        entity="recurring cost"
        onAdd={onAdd}
      />
      {value !== null && occurrenceDate !== null && (
        <p className="mt-1 text-xs text-slate-500">
          Pays the occurrence of {occurrenceDate}.
        </p>
      )}
    </div>
  )
}

/** The Recurring Income select an Income carries (issue #61), mirroring the
 * Recurring Cost select: Incomes only — Expense and Transfer never render
 * it. Picking an income signs it as received, and the helper names the
 * Occurrence the link will pay: `occurrenceDate` is the oldest Unpaid
 * Occurrence's own date for a new link, or the stored pin when the form is
 * editing the very link already on the Transaction (which must never be
 * reassigned by a mere date edit). The None option unlinks. The select
 * carries the inline "＋ Add recurring income…" sentinel (ADR-0013), the
 * mirror of the cost field's. */
export function RecurringIncomeField({
  incomes,
  value,
  occurrenceDate,
  onChange,
  onAdd,
}: {
  incomes: RecurringIncome[]
  value: number | null
  occurrenceDate: string | null
  onChange: (incomeId: number | null) => void
  /** Opens the Recurring Income create modal, hosted by the screen. */
  onAdd: () => void
}) {
  return (
    <div>
      <EntitySelect
        id="tx-recurring-income"
        label="Recurring Income"
        value={value ?? ''}
        onChange={(incomeId) => onChange(incomeId === '' ? null : incomeId)}
        options={incomes.map((income) => ({ id: income.id, label: income.name }))}
        entity="recurring income"
        onAdd={onAdd}
      />
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
  onAdd,
}: {
  id: string
  label: string
  wallets: Wallet[]
  value: number | undefined
  disabled: boolean
  onChange: (walletId: number) => void
  onAdd: () => void
}) {
  return (
    <EntitySelect
      id={id}
      label={label}
      required
      disabled={disabled}
      value={value ?? ''}
      onChange={(next) => {
        if (next !== '') onChange(next)
      }}
      options={wallets.map((wallet) => ({
        id: wallet.id,
        label: `${wallet.name} (${formatEuros(wallet.balance)})`,
      }))}
      entity="wallet"
      onAdd={onAdd}
    />
  )
}
