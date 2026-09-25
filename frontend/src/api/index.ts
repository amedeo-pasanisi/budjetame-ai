/** The API client, split by resource behind one shared transport (issue #17).
 * Screens keep importing from './api' — this barrel is that entry point.
 */

export { ApiError, TOKEN_KEY, apiErrorMessage } from './transport'
export { setLocale, getLocale, formatEuros, formatSignedEuros, formatMonth, formatShortMonth, formatLedgerDate } from './format'

export {
  type Account,
  deleteAccount,
  fetchAccountLanguage,
  fetchAuthConfig,
  fetchCurrentAccount,
  googleSignIn,
  login,
  register,
  requestPasswordReset,
  resetPassword,
  updateAccountLanguage,
} from './auth'

export {
  type Wallet,
  type WalletType,
  createWallet,
  fetchWallets,
  freezeWallet,
  renameWallet,
  unfreezeWallet,
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
  type ExportFile,
  PAGE_LIMIT,
  createTransaction,
  deleteTransaction,
  exportTransactions,
  fetchTransactions,
  undoTransaction,
  updateTransaction,
} from './transactions'

export {
  type BudgetView,
  type CategoryExpense,
  type DashboardSummary,
  type MonthBucket,
  type Trend,
  type TrendKind,
  fetchBudget,
  fetchDashboardSummary,
  fetchTrend,
} from './dashboard'

export {
  type ImportPreview,
  type ImportRow,
  type ImportRowInput,
  type ImportRowRevalidation,
  type ImportRowStatus,
  type ImportRowValidation,
  confirmImport,
  previewImport,
  revalidateImportRows,
  validateImportRow,
} from './imports'

export {
  type BackupFile,
  exportBackup,
  restoreBackup,
} from './backup'

export {
  type IntervalUnit,
  type RecurringCost,
  type RecurringCostInput,
  type RecurringOccurrence,
  createRecurringCost,
  freezeRecurringCost,
  unfreezeRecurringCost,
  fetchRecurringCostOccurrences,
  fetchRecurringCosts,
  setRecurringCostOccurrenceSkipped,
  updateRecurringCost,
} from './recurringCosts'

export {
  type RecurringIncome,
  type RecurringIncomeInput,
  createRecurringIncome,
  freezeRecurringIncome,
  unfreezeRecurringIncome,
  fetchRecurringIncomeOccurrences,
  fetchRecurringIncomes,
  setRecurringIncomeOccurrenceSkipped,
  updateRecurringIncome,
} from './recurringIncomes'
