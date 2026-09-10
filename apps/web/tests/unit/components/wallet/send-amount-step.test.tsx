import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { SendAmountStep } from '@/components/wallet/send/amount-step'
import {
  contactsActions,
  __resetContactsCacheForTests
} from '@/lib/client/contacts-store'
import { resetAllFlows, sendActions } from '@/lib/client/wallet-flow-store'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))

vi.mock('@/lib/analytics/gtag', () => ({
  trackEvent: vi.fn()
}))

vi.mock('@/lib/client/use-yadio-ticker', () => ({
  useYadioRates: () => ({
    rates: null,
    btcUsd: null,
    fetchedAt: null,
    loading: false,
    error: null
  }),
  convertSats: () => null
}))

const LNURLP_URL = 'https://example.com/.well-known/lnurlp/satoshi'
const ADDRESS = 'satoshi@example.com'

function lud16Calls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === LNURLP_URL)
}

describe('SendAmountStep profile fetch', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    resetAllFlows()
    sendActions.setRecipient({
      raw: ADDRESS,
      destination: {
        kind: 'lnurl-pay',
        address: ADDRESS,
        username: 'satoshi',
        host: 'example.com',
        lnurlpUrl: LNURLP_URL
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not re-fetch the LUD-16 profile after upsertRecent updates contacts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === LNURLP_URL) {
        await new Promise(resolve => setTimeout(resolve, 20))
        return new Response(
          JSON.stringify({
            metadata: JSON.stringify([['text/plain', 'Satoshi Nakamoto']])
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const upsertSpy = vi.spyOn(contactsActions, 'upsertRecent')

    render(<SendAmountStep />)

    await waitFor(() => {
      expect(screen.getByText('Satoshi Nakamoto')).toBeInTheDocument()
    })

    expect(lud16Calls(fetchMock)).toHaveLength(1)
    const upsertsAfterSettle = upsertSpy.mock.calls.length
    expect(upsertsAfterSettle).toBeGreaterThanOrEqual(1)
    expect(upsertsAfterSettle).toBeLessThan(5)

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 150))
    })

    expect(lud16Calls(fetchMock)).toHaveLength(1)
    expect(upsertSpy.mock.calls.length).toBe(upsertsAfterSettle)
  })
})
