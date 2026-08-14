import { act, screen, waitFor } from '@testing-library/react'
import { generateSigner } from '@lawallet-nwc/sdk'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAddresses, useAuth } from '../src'
import { ENDPOINT, StubEventSource, renderWithProvider } from './helpers'
import { server } from './setup'

let authRef: ReturnType<typeof useAuth> | null = null

function AddressList() {
  authRef = useAuth()
  const { addresses, loading } = useAddresses()
  if (loading) return <span>loading…</span>
  return <span data-testid="count">{addresses?.length ?? -1}</span>
}

describe('useResource + SSE invalidation', () => {
  beforeEach(() => {
    StubEventSource.reset()
    authRef = null
  })

  it('fetches once for mounted consumers and refetches on the declared SSE event', async () => {
    let listCalls = 0
    let listSize = 1
    server.use(
      http.get(`${ENDPOINT}/api/settings`, () =>
        HttpResponse.json({ domain: 'instance.test' })
      ),
      http.get(`${ENDPOINT}/api/wallet/addresses`, () => {
        listCalls += 1
        return HttpResponse.json(
          Array.from({ length: listSize }, (_, i) => ({
            username: `user${i}`,
            mode: 'IDLE'
          }))
        )
      })
    )

    renderWithProvider(<AddressList />)
    const { nsec } = generateSigner()
    await act(() => authRef!.loginWithNsec(nsec))

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('1')
    )
    const callsAfterLoad = listCalls

    // An SSE change notification arrives → the hook refetches on its own.
    listSize = 2
    await waitFor(() => expect(StubEventSource.instances).toHaveLength(1))
    act(() => {
      StubEventSource.instances[0].emit(
        'addresses:updated',
        JSON.stringify({ type: 'addresses:updated', timestamp: 2 })
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('count').textContent).toBe('2')
    )
    expect(listCalls).toBeGreaterThan(callsAfterLoad)
  })
})
