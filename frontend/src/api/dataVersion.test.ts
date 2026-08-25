/** The client-side cache clock (ADR-0022): a global version bumped by every
 * successful write through the transport — and only by writes. Mounted tabs
 * subscribe via useDataVersion; reads and the import pipeline's read-only
 * computation endpoints never bump. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
  bumpDataVersion,
  getDataVersion,
  subscribeDataVersion,
  useDataVersion,
} from './dataVersion'
import { request } from './transport'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dataVersion store', () => {
  it('starts at 0 and notifies subscribers on every bump', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDataVersion(listener)
    expect(getDataVersion()).toBe(0)

    bumpDataVersion()
    bumpDataVersion()
    expect(getDataVersion()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    bumpDataVersion()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('useDataVersion re-renders with the new version on a bump', () => {
    const { result } = renderHook(() => useDataVersion())
    expect(result.current).toBe(getDataVersion())

    act(() => bumpDataVersion())
    expect(result.current).toBe(getDataVersion())
  })
})

/** A successful response for `request`, whatever the endpoint. */
function okResponse(): Response {
  return new Response(JSON.stringify({}), { status: 200 })
}

describe('transport bumps on writes only (ADR-0022)', () => {
  it('bumps after a successful write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()))
    const before = getDataVersion()

    await request('/wallets', {
      method: 'POST',
      json: { name: 'Cash', type: 'cash' },
      token: 't',
      errorMessage: 'Could not create wallet',
    })

    expect(getDataVersion()).toBe(before + 1)
  })

  it('does not bump when the write fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'duplicate' }), { status: 409 }),
      ),
    )
    const before = getDataVersion()

    await expect(
      request('/wallets', {
        method: 'POST',
        json: { name: 'Cash', type: 'cash' },
        token: 't',
        errorMessage: 'Could not create wallet',
      }),
    ).rejects.toThrow()

    expect(getDataVersion()).toBe(before)
  })

  it('never bumps on reads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()))
    const before = getDataVersion()

    await request('/wallets?include_frozen=true', {
      token: 't',
      errorMessage: 'Could not load wallets',
    })

    expect(getDataVersion()).toBe(before)
  })

  it('never bumps on the import computation endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()))
    const before = getDataVersion()

    // The import pipeline's POSTs write nothing: validating one row or a
    // batch must not look like a write (ADR-0022).
    await request('/import/validate-row', {
      method: 'POST',
      json: {},
      token: 't',
      errorMessage: 'Could not validate the row',
    })
    await request('/import/revalidate-rows', {
      method: 'POST',
      json: {},
      token: 't',
      errorMessage: 'Could not re-validate the rows',
    })
    await request('/import/preview', {
      method: 'POST',
      token: 't',
      errorMessage: 'Could not read the file',
    })

    expect(getDataVersion()).toBe(before)
  })
})
