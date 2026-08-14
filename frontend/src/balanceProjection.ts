/** Balance projection for the Transaction form's preview (issue #24).

 * The Wallet's current Balance already includes every Transaction on it —
 * including the one being edited. The preview must therefore show
 * Balance-before-this-Transaction → Balance-after-the-new-amount: when
 * editing, the old amount is removed from the current Balance first, then the
 * new amount is applied. Creating passes editedAmount = null and the current
 * Balance is the "before" number unchanged. Editing is safe because the
 * Wallet and type are locked while editing, so the old contribution is always
 * computable; Opening Balance Transactions cannot be edited and never reach
 * this module. The preview components and the ⚠ Cash-negative warning both
 * consume these projections.
 */

/** The projected Balance of one Wallet. */
export type BalanceProjection = {
  /** The Wallet's Balance excluding the Transaction being edited (or the
   * current Balance when creating). */
  before: number
  /** The projected Balance after the new amount is applied. */
  after: number
}

/** The projected Balances of both Wallets a Transfer moves between. */
export type TransferProjection = {
  source: BalanceProjection
  destination: BalanceProjection
}

export type ProjectBalanceInput = {
  currentBalance: string
  type: 'expense' | 'income'
  /** The draft's new amount, always positive. */
  newAmount: number
  /** The amount of the Transaction being edited, or null when creating. */
  editedAmount: string | null
}

/** Project the one Wallet an Expense/Income moves. */
export function projectBalance({
  currentBalance,
  type,
  newAmount,
  editedAmount,
}: ProjectBalanceInput): BalanceProjection {
  const before = amountToNumber(currentBalance) - signedContribution(type, editedAmount)
  const after = before + signed(type, newAmount)
  return { before: toCents(before), after: toCents(after) }
}

export type ProjectTransferInput = {
  sourceBalance: string
  destinationBalance: string
  /** The draft's new amount, always positive. */
  newAmount: number
  /** The amount of the Transfer being edited, or null when creating. */
  editedAmount: string | null
}

/** Project both Wallets a Transfer moves between. */
export function projectTransfer({
  sourceBalance,
  destinationBalance,
  newAmount,
  editedAmount,
}: ProjectTransferInput): TransferProjection {
  // The source's Balance includes the outgoing leg (−amount) and the
  // destination's includes the incoming leg (+amount); removing the old
  // amount restores each pre-Transfer Balance.
  const oldAmount = editedAmount === null ? 0 : amountToNumber(editedAmount)
  const sourceBefore = amountToNumber(sourceBalance) + oldAmount
  const destinationBefore = amountToNumber(destinationBalance) - oldAmount
  return {
    source: { before: toCents(sourceBefore), after: toCents(sourceBefore - newAmount) },
    destination: { before: toCents(destinationBefore), after: toCents(destinationBefore + newAmount) },
  }
}

function amountToNumber(amount: string): number {
  return Number.parseFloat(amount)
}

/** Amounts are euro strings and inputs with cent precision; round the
 * projection to cents so float arithmetic noise never leaks into the display
 * or the Cash-negative warning (the boundary case is exact either way: x − x
 * is 0 in IEEE 754). */
function toCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

/** The signed effect of the edited Transaction on its Wallet's current
 * Balance: an Expense already subtracted its amount, an Income already added
 * it. */
function signedContribution(type: 'expense' | 'income', editedAmount: string | null): number {
  if (editedAmount === null) return 0
  return signed(type, amountToNumber(editedAmount))
}

/** The signed money movement of an Expense (−) or Income (+). */
function signed(type: 'expense' | 'income', amount: number): number {
  return type === 'expense' ? -amount : amount
}
