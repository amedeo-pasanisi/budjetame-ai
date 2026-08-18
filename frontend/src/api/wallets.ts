/** Wallets resource (issue #17). */

import { request } from './transport'

export type WalletType = 'checking' | 'credit_card' | 'cash' | 'contact'

export type Wallet = {
  id: number
  name: string
  type: WalletType
  balance: string
  frozen: boolean
  created_at: string
}

export async function fetchWallets(token: string, includeFrozen = false): Promise<Wallet[]> {
  const query = includeFrozen ? '?include_frozen=true' : ''
  const response = await request(`/wallets${query}`, {
    token,
    errorMessage: 'Could not load wallets',
  })
  return (await response.json()) as Wallet[]
}

export async function createWallet(
  token: string,
  input: { name: string; type: WalletType; openingBalance: string },
): Promise<Wallet> {
  const response = await request('/wallets', {
    method: 'POST',
    token,
    json: {
      name: input.name,
      type: input.type,
      opening_balance: input.openingBalance === '' ? '0.00' : input.openingBalance,
    },
    errorMessage: 'Could not create wallet',
  })
  return (await response.json()) as Wallet
}

export async function renameWallet(token: string, walletId: number, name: string): Promise<Wallet> {
  const response = await request(`/wallets/${walletId}`, {
    method: 'PATCH',
    token,
    json: { name },
    errorMessage: 'Could not rename wallet',
  })
  return (await response.json()) as Wallet
}

export async function freezeWallet(token: string, walletId: number): Promise<void> {
  await request(`/wallets/${walletId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not freeze wallet',
  })
}

export async function unfreezeWallet(token: string, walletId: number): Promise<Wallet> {
  const response = await request(`/wallets/${walletId}/unfreeze`, {
    method: 'POST',
    token,
    errorMessage: 'Could not unfreeze wallet',
  })
  return (await response.json()) as Wallet
}
