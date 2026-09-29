import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SendAmountStep } from '@/components/wallet/send/amount-step'
import {
  contactsActions,
  __resetContactsCacheForTests
} from '@/lib/client/contacts-store'
import {
  resetAllFlows,
  sendActions,
  useSendFlow
} from '@/lib/client/wallet-flow-store'

const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() })
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

function SendStoreProbe() {
  const flow = useSendFlow()
  return <div data-testid="send-store" data-comment={flow.comment} />
}

function payRequestResponse(commentAllowed?: number) {
  return new Response(
    JSON.stringify({
      metadata: JSON.stringify([['text/plain', 'Satoshi Nakamoto']]),
      ...(commentAllowed === undefined ? {} : { commentAllowed })
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

function stubPayRequest(commentAllowed?: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === LNURLP_URL) return payRequestResponse(commentAllowed)
      return new Response(null, { status: 404 })
    })
  )
}

function lightningRecipient() {
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
}

describe('SendAmountStep payer note', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    resetAllFlows()
    pushMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the note immediately, before recipient metadata returns', () => {
    lightningRecipient()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    render(<SendAmountStep />)

    expect(screen.getByLabelText('Note for recipient')).toBeInTheDocument()
    expect(screen.getByText('The recipient will see this.')).toBeInTheDocument()
    expect(screen.queryByText(/\d+ max/)).toBeNull()
    expect(document.querySelector('.animate-pulse')).toBeNull()
  })

  it('hides the note when the address does not accept comments', async () => {
    lightningRecipient()
    stubPayRequest(0)
    render(<SendAmountStep />)

    await waitFor(() => {
      expect(screen.getByText('Satoshi Nakamoto')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Note for recipient')).toBeNull()
    expect(screen.queryByText('The recipient will see this.')).toBeNull()
  })

  it('hides the note when commentAllowed is missing', async () => {
    lightningRecipient()
    stubPayRequest()
    render(<SendAmountStep />)

    await waitFor(() => {
      expect(screen.getByText('Satoshi Nakamoto')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Note for recipient')).toBeNull()
  })

  it('drops a leftover note when the destination cannot carry one', async () => {
    const user = userEvent.setup()
    sendActions.setRecipient({
      raw: 'lnbc1',
      destination: {
        kind: 'invoice',
        bolt11: 'lnbc1',
        amountSats: null,
        description: 'Invoice memo',
        paymentHash: null,
        expiresAt: null
      }
    })
    sendActions.setComment('leftover')
    render(
      <>
        <SendStoreProbe />
        <SendAmountStep />
      </>
    )

    expect(screen.queryByLabelText('Note for recipient')).toBeNull()
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByTestId('send-store')).toHaveAttribute('data-comment', '')
    expect(pushMock).toHaveBeenCalledWith('/wallet/send/preview')
  })

  it('starts a new recipient with an empty note', async () => {
    sendActions.setComment('previous payment')
    lightningRecipient()
    stubPayRequest(200)
    render(<SendAmountStep />)

    expect(await screen.findByLabelText('Note for recipient')).toHaveValue('')
    expect(await screen.findByText('200 max')).toBeInTheDocument()
  })

  it('collects an optional note and passes the trimmed text on', async () => {
    const user = userEvent.setup()
    lightningRecipient()
    sendActions.setComment('Coffee')
    stubPayRequest(200)
    render(
      <>
        <SendStoreProbe />
        <SendAmountStep />
      </>
    )

    const note = await screen.findByLabelText('Note for recipient')
    expect(note).toHaveValue('Coffee')
    expect(screen.getByText('The recipient will see this.')).toBeInTheDocument()
    expect(await screen.findByText('194 left')).toBeInTheDocument()

    await user.clear(note)
    expect(screen.getByText('200 max')).toBeInTheDocument()
    await user.type(note, '  thanks  ')
    expect(screen.getByText('190 left')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Enter 2'))
    await user.click(screen.getByLabelText('Enter 1'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByTestId('send-store')).toHaveAttribute(
      'data-comment',
      'thanks'
    )
    expect(pushMock).toHaveBeenCalledWith('/wallet/send/preview')
  })

  it('stops the note at the recipient comment budget', async () => {
    const user = userEvent.setup()
    lightningRecipient()
    stubPayRequest(4)
    render(<SendAmountStep />)

    const note = await screen.findByLabelText('Note for recipient')
    expect(await screen.findByText('4 max')).toBeInTheDocument()
    await user.type(note, 'hello')

    expect(note).toHaveValue('hell')
    expect(screen.getByText('0 left')).toBeInTheDocument()
  })

  it('shows the note for a raw LNURL that accepts comments', async () => {
    sendActions.setRecipient({
      raw: 'lnurl1example',
      destination: {
        kind: 'lnurl-pay',
        lnurlpUrl: LNURLP_URL,
        address: null,
        username: null,
        host: null
      }
    })
    stubPayRequest(32)
    render(<SendAmountStep />)

    expect(await screen.findByLabelText('Note for recipient')).toBeInTheDocument()
    expect(await screen.findByText('32 max')).toBeInTheDocument()
  })
})
