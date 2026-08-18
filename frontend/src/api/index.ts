/** The API client, split by resource behind one shared transport (issue #17).
 * Screens keep importing from './api' — this barrel is that entry point.
 */

export { ApiError, TOKEN_KEY, apiErrorMessage } from './transport'
export { formatEuros } from './format'

export { type Account, fetchCurrentAccount, login } from './auth'

export {
  type Wallet,
  type WalletType,
  createWallet,
  fetchWallets,
  freezeWallet,
  renameWallet,
} from './wallets'

export {
  type Category,
  type CategoryType,
  CategoryMergeConflict,
  createCategory,
  deleteCategory,
  fetchCategories,
  mergeCategories,
  updateCategory,
} from './categories'

export {
  type Transaction,
  type TransactionFilters,
  type TransactionInput,
  type TransactionPage,
  type TransactionType,
  PAGE_LIMIT,
  createTransaction,
  deleteTransaction,
  fetchTransactions,
  updateTransaction,
} from './transactions'

export {
  type CategoryExpense,
  type DashboardSummary,
  type ExpenseTrend,
  type MonthBucket,
  fetchDashboardSummary,
  fetchExpenseTrend,
} from './dashboard'

export {
  type ImportPreview,
  type ImportRow,
  type ImportRowInput,
  type ImportRowStatus,
  confirmImport,
  previewImport,
} from './imports'
