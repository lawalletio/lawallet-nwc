import { act, screen, waitFor } from '@testing-library/react'
import { generateSigner } from '@lawallet-nwc/sdk'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuth, useUser } from '../src'
import { ENDPOINT, StubEventSource, renderWithProvider } from './helpers'
import { server } from './setup'

function AuthProbe() {
  const auth = useAuth()
  const { user } = useUser()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="npub">{auth.npub ?? 'none'}</span>
      <span data-testid="user">{user?.userId ?? 'none'}</span>
    </div>
  )
}

let lastAuthHeader: string | null = null

function stubApi() {
  lastAuthHeader = null
  server.use(
    http.get(`${ENDPOINT}/api/settings`, () =>
      HttpResponse.json({ domain: 'instance.test' })
    ),
    http.get(`${ENDPOINT}/api/users/me`, ({ request }) => {
      lastAuthHeader = request.headers.get('authorization')
      return HttpResponse.json({ userId: 'u1', lightningAddress: null })
    })
  )
}

describe('useAuth', () => {
  beforeEach(() => StubEventSource.reset())

  it('logs in with an nsec, signs API calls, and logs out clean', async () => {
    stubApi()
    const { nsec, npub } = generateSigner()

    let authRef: ReturnType<typeof useAuth> | null = null
    function Grab() {
      authRef = useAuth()
      return <AuthProbe />
    }
    renderWithProvider(<Grab />)

    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')

    await act(() => authRef!.loginWithNsec(nsec))

    expect(screen.getByTestId('status').textContent).toBe('authenticated')
    expect(screen.getByTestId('npub').textContent).toBe(npub)

    // The data hook wakes up and its request carries a NIP-98 signature.
    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('u1')
    )
    expect(lastAuthHeader).toMatch(/^Nostr /)

    // Not remembered by default.
    expect(localStorage.getItem('lawallet:nsec')).toBeNull()

    act(() => authRef!.logout())
    expect(screen.getByTestId('status').textContent).toBe('unauthenticated')
    expect(screen.getByTestId('user').textContent).toBe('none')
  })

  it('remembers and restores a login across mounts when asked', async () => {
    stubApi()
    const { nsec, npub } = generateSigner()

    let authRef: ReturnType<typeof useAuth> | null = null
    function Grab() {
      authRef = useAuth()
      return <AuthProbe />
    }

    const first = renderWithProvider(<Grab />)
    await act(() => authRef!.loginWithNsec(nsec, { remember: true }))
    expect(localStorage.getItem('lawallet:nsec')).toBe(nsec)
    first.unmount()

    renderWithProvider(<Grab />)
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('authenticated')
    )
    expect(screen.getByTestId('npub').textContent).toBe(npub)
  })

  it('opens (and closes) the SSE stream with the session', async () => {
    stubApi()
    const { nsec } = generateSigner()

    let authRef: ReturnType<typeof useAuth> | null = null
    function Grab() {
      authRef = useAuth()
      return <AuthProbe />
    }
    renderWithProvider(<Grab />)

    await act(() => authRef!.loginWithNsec(nsec))
    await waitFor(() => expect(StubEventSource.instances).toHaveLength(1))
    expect(
      StubEventSource.instances[0].url.startsWith(
        `${ENDPOINT}/api/events?token=`
      )
    ).toBe(true)

    act(() => authRef!.logout())
    await waitFor(() => expect(StubEventSource.instances[0].closed).toBe(true))
  })
})
