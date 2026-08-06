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

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
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

