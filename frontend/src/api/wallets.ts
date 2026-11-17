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

/** Freeze a Wallet at balance EUR 0 (ADR-0002): an explicit action since
 * ADR-0034 made DELETE on a Wallet the real delete. */
export async function freezeWallet(token: string, walletId: number): Promise<Wallet> {
  const response = await request(`/wallets/${walletId}/freeze`, {
    method: 'POST',
    token,
    errorMessage: 'Could not freeze wallet',
  })
  return (await response.json()) as Wallet
}

/** Delete a Frozen Wallet with no history for good (ADR-0034). The backend
 * refuses an active Wallet or one with any Transaction with a rule error
 * whose message says why — surfaced as the ApiError's message, the single
 * source of the explanation the modal shows. Returns the deleted row: the
 * Undo replay payload. */
export async function deleteWallet(token: string, walletId: number): Promise<Wallet> {
  const response = await request(`/wallets/${walletId}`, {
    method: 'DELETE',
    token,
    errorMessage: 'Could not delete wallet',
    readDetail: true,
  })
  return (await response.json()) as Wallet
}

/** Undo a Wallet delete by re-inserting the row the delete returned, with
 * its original id, still frozen (ADR-0034, mirroring the Transaction undo
 * of ADR-0031). Answers 409 when the name was taken in the meantime. */
export async function undoWalletDelete(token: string, wallet: Wallet): Promise<Wallet> {
  const response = await request('/wallets/undo', {
    method: 'POST',
    token,
    json: wallet,
    errorMessage: 'Could not undo the wallet delete',
    readDetail: true,
  })
  return (await response.json()) as Wallet
}

export async function unfreezeWallet(token: string, walletId: number): Promise<Wallet> {
  const response = await request(`/wallets/${walletId}/unfreeze`, {
    method: 'POST',
    token,
    errorMessage: 'Could not unfreeze wallet',
  })
  return (await response.json()) as Wallet
}
