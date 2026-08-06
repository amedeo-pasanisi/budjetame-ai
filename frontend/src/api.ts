const API_BASE = '/api'

export const TOKEN_KEY = 'budjetame.token'

export type Account = { id: number; email: string }

export type WalletType = 'checking' | 'credit_card' | 'cash' | 'contact'

export type Wallet = {
  id: number
  name: string
  type: WalletType
  balance: string
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

export async function fetchWallets(token: string): Promise<Wallet[]> {
  const response = await fetch(`${API_BASE}/wallets`, {
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


