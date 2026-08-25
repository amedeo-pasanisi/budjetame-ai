/** Auth resource: login, registration, Google sign-in, and the current
 * Account (issues #17, #82, #81). */

import { request } from './transport'

export type Account = { id: number; email: string }

export type AuthConfig = { google_client_id: string }

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

/** Public sign-in options (issue #81): an empty client id means no Google
 * button. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  const response = await request('/auth/config', {
    errorMessage: 'Could not load sign-in options',
  })
  return (await response.json()) as AuthConfig
}

/** Sign in with a Google ID token (issue #81): auto-provisions a new
 * Account or links to the existing one by email (ADR-0021). */
export async function googleSignIn(idToken: string): Promise<string> {
  const response = await request('/auth/google', {
    method: 'POST',
    json: { id_token: idToken },
    errorMessage: 'Google sign-in failed',
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
