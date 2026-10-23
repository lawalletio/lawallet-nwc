import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearApiCache, useApi } from '@/lib/client/hooks/use-api'
import { ApiClientError, createApiClient } from '@/lib/client/api-client'
import { isApiReachable } from '@/lib/client/api-reachability'

const STORAGE_KEY = 'lawallet-api-cache'
const AUTH_KEY = 'authenticated:user-pubkey:USER'

const authMock = vi.hoisted(() => ({
  getMock: vi.fn(),
  authState: {
    status: 'authenticated' as 'loading' | 'unauthenticated' | 'authenticated',
    pubkey: 'user-pubkey' as string | null,
    role: 'USER' as string | null,
    apiClient: {} as { get: (path: string) => Promise<unknown> }
  }
}))
authMock.authState.apiClient.get = authMock.getMock

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => authMock.authState
}))

function MeReader() {
  const { data, loading, error } = useApi<{ lightningAddress: string }>(
    '/api/users/me'
  )
  return (
    <div
      data-testid="me"
      data-address={data?.lightningAddress ?? ''}
      data-loading={String(loading)}
      data-error={error?.message ?? ''}
    />
  )
}

/** What the previous session left behind; `clearApiCache` = a cold launch. */
function seedPreviousSession(authKey = AUTH_KEY) {
  clearApiCache()
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      authKey,
      entries: {
        '/api/users/me': {
          data: { lightningAddress: 'cached@wallet.test' },
          fetchedAt: Date.now() - 60_000
        }
      }
    })
  )
}

describe('useApi local-first persistence', () => {
  beforeEach(() => {
    authMock.getMock.mockReset()
  })

  afterEach(() => {
    clearApiCache()
  })

  it('paints the last session before the network answers, then persists the live copy', async () => {
    seedPreviousSession()
    let answer: (value: unknown) => void = () => {}
    authMock.getMock.mockReturnValue(new Promise(resolve => (answer = resolve)))

    render(<MeReader />)

    const me = screen.getByTestId('me')
    expect(me).toHaveAttribute('data-address', 'cached@wallet.test')
    expect(me).toHaveAttribute('data-loading', 'false')
    // Cached copies are never "fresh": the mount still revalidates.
    expect(authMock.getMock).toHaveBeenCalledWith('/api/users/me')

    answer({ lightningAddress: 'live@wallet.test' })
    await waitFor(() =>
      expect(me).toHaveAttribute('data-address', 'live@wallet.test')
    )
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
        authKey: AUTH_KEY,
        entries: {
          '/api/users/me': { data: { lightningAddress: 'live@wallet.test' } }
        }
      })
    )
  })

  it("never paints another account's persisted data", () => {
    seedPreviousSession('authenticated:someone-else:USER')
    authMock.getMock.mockReturnValue(new Promise(() => {}))

    render(<MeReader />)

    expect(screen.getByTestId('me')).toHaveAttribute('data-address', '')
    expect(screen.getByTestId('me')).toHaveAttribute('data-loading', 'true')
  })

  it('keeps the cached copy without an error when the network is unreachable', async () => {
    seedPreviousSession()
    authMock.getMock.mockRejectedValue(new TypeError('Failed to fetch'))

    render(<MeReader />)

    await waitFor(() => expect(authMock.getMock).toHaveBeenCalled())
    const me = screen.getByTestId('me')
    await waitFor(() => expect(me).toHaveAttribute('data-loading', 'false'))
    expect(me).toHaveAttribute('data-address', 'cached@wallet.test')
    expect(me).toHaveAttribute('data-error', '')
  })

  it('still surfaces a real HTTP error over cached data', async () => {
    seedPreviousSession()
    authMock.getMock.mockRejectedValue(new ApiClientError(500, 'Boom'))

    render(<MeReader />)

    await waitFor(() =>
      expect(screen.getByTestId('me')).toHaveAttribute('data-error', 'Boom')
    )
  })

  it('logout wipes the persisted copy', () => {
    seedPreviousSession()
    clearApiCache()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('api-client reachability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flips unreachable on a network failure and back on any HTTP answer', async () => {
    const client = createApiClient({ getToken: () => null })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )
    await expect(client.get('/api/users/me')).rejects.toThrow(TypeError)
    expect(isApiReachable()).toBe(false)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    )
    await expect(client.get('/api/users/me')).rejects.toThrow(ApiClientError)
    expect(isApiReachable()).toBe(true)
  })
})
