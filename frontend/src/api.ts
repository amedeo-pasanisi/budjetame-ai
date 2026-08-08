const API_BASE = '/api'

export const TOKEN_KEY = 'budjetame.token'

export type Account = { id: number; email: string }

export type WalletType = 'checking' | 'credit_card' | 'cash' | 'contact'

export type Wallet = {
  id: number
  name: string
  type: WalletType
  balance: string
  frozen: boolean
  created_at: string
}

export type CategoryType = 'expense' | 'income'

export type Category = {
  id: number
  name: string
  type: CategoryType
  icon: string | null
  color: string
  created_at: string
}

export type TransactionType = 'expense' | 'income' | 'transfer' | 'opening_balance'

export type DashboardSummary = {
  net_worth: string
  month: string
  income: string
  expenses: string
  expenses_by_category: CategoryExpense[]
}

export type CategoryExpense = {
  category_id: number | null
  name: string
  icon: string | null
  // null for the "Uncategorized" slice — the frontend renders a neutral color
  color: string | null
  amount: string
}

export type Transaction = {
  id: number
  type: TransactionType
  amount: string
  date: string
  wallet_id: number | null
  source_wallet_id: number | null
  destination_wallet_id: number | null
  category_id: number | null
  description: string | null
  latitude: string | null
  longitude: string | null
  warning: boolean
  created_at: string
}

export type TransactionInput =
  | {
      type: 'expense' | 'income'
      amount: string
      date: string
      walletId: number
      categoryId: number | null
      description: string
      latitude: string | null
      longitude: string | null
    }
  | {
      type: 'transfer'
      amount: string
      date: string
      sourceWalletId: number
      destinationWalletId: number
      description: string
      latitude: string | null
      longitude: string | null
    }

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Human message for an API failure, shared by every screen. The status codes
 * are part of the API contract (409 duplicate name, 422 validation). */
export function apiErrorMessage(
  error: ApiError,
  conflictMessage: string,
  fallback: string,
): string {
  if (error.status === 409) return conflictMessage
  if (error.status === 422) return 'Check the fields and try again.'
  return fallback
}

/** Display an amount string from the API as euros ("€100.00", "€-15.00"). */
export function formatEuros(amount: string): string {
  return `€${amount}`
}

export async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    throw new ApiError('Login failed', response.status)
  }
  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

export async function fetchCurrentAccount(token: string): Promise<Account> {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Not authenticated', response.status)
  }
  return (await response.json()) as Account
}

export async function fetchDashboardSummary(
  token: string,
  month?: string,
): Promise<DashboardSummary> {
  const query = month !== undefined ? `?month=${month}` : ''
  const response = await fetch(`${API_BASE}/dashboard/summary${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not load the dashboard', response.status)
  }
  return (await response.json()) as DashboardSummary
}

export async function fetchWallets(token: string, includeFrozen = false): Promise<Wallet[]> {
  const query = includeFrozen ? '?include_frozen=true' : ''
  const response = await fetch(`${API_BASE}/wallets${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not load wallets', response.status)
  }
  return (await response.json()) as Wallet[]
}

export async function createWallet(
  token: string,
  input: { name: string; type: WalletType; openingBalance: string },
): Promise<Wallet> {
  const response = await fetch(`${API_BASE}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      opening_balance: input.openingBalance === '' ? '0.00' : input.openingBalance,
    }),
  })
  if (!response.ok) {
    throw new ApiError('Could not create wallet', response.status)
  }
  return (await response.json()) as Wallet
}

export async function renameWallet(token: string, walletId: number, name: string): Promise<Wallet> {
  const response = await fetch(`${API_BASE}/wallets/${walletId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    throw new ApiError('Could not rename wallet', response.status)
  }
  return (await response.json()) as Wallet
}

export async function freezeWallet(token: string, walletId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/wallets/${walletId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not freeze wallet', response.status)
  }
}

export async function fetchCategories(token: string): Promise<Category[]> {
  const response = await fetch(`${API_BASE}/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not load categories', response.status)
  }
  return (await response.json()) as Category[]
}

export async function createCategory(
  token: string,
  input: { name: string; type: CategoryType; icon: string; color: string },
): Promise<Category> {
  const response = await fetch(`${API_BASE}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      icon: input.icon,
      color: input.color,
    }),
  })
  if (!response.ok) {
    throw new ApiError('Could not create category', response.status)
  }
  return (await response.json()) as Category
}

export async function updateCategory(
  token: string,
  categoryId: number,
  input: { name: string; icon: string; color: string },
): Promise<Category> {
  const response = await fetch(`${API_BASE}/categories/${categoryId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // An empty icon is sent as "" (not null): the backend treats null as
    // "unchanged" and "" as "clear the icon".
    body: JSON.stringify({
      name: input.name,
      icon: input.icon,
      color: input.color,
    }),
  })
  if (!response.ok) {
    throw new ApiError('Could not update category', response.status)
  }
  return (await response.json()) as Category
}

export async function deleteCategory(token: string, categoryId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/categories/${categoryId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not delete category', response.status)
  }
}

export type TransactionFilters = {
  walletId?: number
  categoryId?: number
  fromDate?: string
  toDate?: string
}

export async function fetchTransactions(
  token: string,
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
  const params = new URLSearchParams()
  if (filters.walletId !== undefined) {
    params.set('wallet_id', String(filters.walletId))
  }
  if (filters.categoryId !== undefined) {
    params.set('category_id', String(filters.categoryId))
  }
  if (filters.fromDate !== undefined && filters.fromDate !== '') {
    params.set('from_date', filters.fromDate)
  }
  if (filters.toDate !== undefined && filters.toDate !== '') {
    params.set('to_date', filters.toDate)
  }
  const query = params.size > 0 ? `?${params.toString()}` : ''
  const response = await fetch(`${API_BASE}/transactions${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not load transactions', response.status)
  }
  return (await response.json()) as Transaction[]
}

export async function createTransaction(
  token: string,
  input: TransactionInput,
): Promise<Transaction> {
  const base = {
    type: input.type,
    amount: input.amount,
    date: input.date,
    description: input.description === '' ? null : input.description,
    latitude: input.latitude,
    longitude: input.longitude,
  }
  const body =
    input.type === 'transfer'
      ? {
          ...base,
          source_wallet_id: input.sourceWalletId,
          destination_wallet_id: input.destinationWalletId,
        }
      : {
          ...base,
          wallet_id: input.walletId,
          category_id: input.categoryId,
        }
  const response = await fetch(`${API_BASE}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError('Could not create transaction', response.status)
  }
  return (await response.json()) as Transaction
}

export async function updateTransaction(
  token: string,
  transactionId: number,
  input: {
    amount: string
    date: string
    categoryId?: number | null
    description: string
    latitude?: string | null
    longitude?: string | null
  },
): Promise<Transaction> {
  const body: Record<string, unknown> = {
    amount: input.amount,
    date: input.date,
    description: input.description === '' ? null : input.description,
  }
  // Transfers never carry a Category; omit category_id entirely for them.
  if (input.categoryId !== undefined) {
    body.category_id = input.categoryId
  }
  // The location is always sent: values set it, null clears it (the backend
  // applies any field present in the payload).
  body.latitude = input.latitude ?? null
  body.longitude = input.longitude ?? null
  const response = await fetch(`${API_BASE}/transactions/${transactionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError('Could not update transaction', response.status)
  }
  return (await response.json()) as Transaction
}

export async function deleteTransaction(token: string, transactionId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/transactions/${transactionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new ApiError('Could not delete transaction', response.status)
  }
}


