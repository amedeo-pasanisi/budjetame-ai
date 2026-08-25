/** Auth resource: login and the current Account (issue #17). */

import { request } from './transport'

export type Account = { id: number; email: string }

export async function login(email: string, password: string): Promise<string> {
  const response = await request('/auth/login', {
    method: 'POST',
    json: { email, password },
    errorMessage: 'Login failed',
  })
  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

/** Create an Account and sign it in (ADR-0020): a 409 means the email
 * already has an Account. */
export async function register(email: string, password: string): Promise<string> {
  const response = await request('/auth/register', {
    method: 'POST',
    json: { email, password },
    errorMessage: 'Registration failed',
  })
  const body = (await response.json()) as { access_token: string }
  return body.access_token
}

export async function fetchCurrentAccount(token: string): Promise<Account> {
  const response = await request('/auth/me', {
    token,
    errorMessage: 'Not authenticated',
  })
  return (await response.json()) as Account
}
