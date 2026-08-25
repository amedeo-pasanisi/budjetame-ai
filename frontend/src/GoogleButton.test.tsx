/** The "Sign in with Google" button (issue #81): config-driven visibility,
 * script loading, and credential hand-off. The API and the Google Identity
 * Services glue are mocked — jsdom has neither fetch-to-backend nor
 * window.google. */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { GoogleButton } from './GoogleButton'
import { fetchAuthConfig } from './api'
import { loadGoogleIdentityScript, renderGoogleButton } from './googleIdentity'

vi.mock('./api', () => ({
  fetchAuthConfig: vi.fn(),
}))

vi.mock('./googleIdentity', () => ({
  loadGoogleIdentityScript: vi.fn(),
  renderGoogleButton: vi.fn(),
}))

const fetchAuthConfigMock = vi.mocked(fetchAuthConfig)
const loadScriptMock = vi.mocked(loadGoogleIdentityScript)
const renderButtonMock = vi.mocked(renderGoogleButton)

describe('GoogleButton (issue #81)', () => {
  it('renders nothing when the backend has no Google client id', async () => {
    fetchAuthConfigMock.mockResolvedValue({ google_client_id: '' })

    const { container } = render(<GoogleButton onIdToken={vi.fn()} />)

    await waitFor(() => expect(fetchAuthConfigMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the Google button once configured and the script has loaded', async () => {
    fetchAuthConfigMock.mockResolvedValue({
      google_client_id: 'x.apps.googleusercontent.com',
    })
    loadScriptMock.mockResolvedValue(undefined)

    render(<GoogleButton onIdToken={vi.fn()} />)

    await waitFor(() =>
      expect(renderButtonMock).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        'x.apps.googleusercontent.com',
        expect.any(Function),
      ),
    )
  })

  it('hands the Google ID token to the caller', async () => {
    fetchAuthConfigMock.mockResolvedValue({
      google_client_id: 'x.apps.googleusercontent.com',
    })
    loadScriptMock.mockResolvedValue(undefined)
    renderButtonMock.mockImplementation((_container, _clientId, onIdToken) => {
      onIdToken('google-issued-id-token')
    })
    const onIdToken = vi.fn()

    render(<GoogleButton onIdToken={onIdToken} />)

    await waitFor(() => expect(onIdToken).toHaveBeenCalledWith('google-issued-id-token'))
  })

  it('hides the button when the config request fails', async () => {
    fetchAuthConfigMock.mockRejectedValue(new Error('network down'))

    const { container } = render(<GoogleButton onIdToken={vi.fn()} />)

    await waitFor(() => expect(fetchAuthConfigMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('hides the button when the Google script fails to load', async () => {
    fetchAuthConfigMock.mockResolvedValue({
      google_client_id: 'x.apps.googleusercontent.com',
    })
    loadScriptMock.mockRejectedValue(new Error('blocked'))

    const { container } = render(<GoogleButton onIdToken={vi.fn()} />)

    await waitFor(() => expect(loadScriptMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
