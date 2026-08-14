import { act, screen, waitFor } from '@testing-library/react'
import { generateSigner } from '@lawallet-nwc/sdk'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth, useClaimAddress, type ClaimAddressState } from '../src'
import { ENDPOINT, StubEventSource, renderWithProvider } from './helpers'
import { server } from './setup'

const PREIMAGE = 'ab'.repeat(32)
const VERIFY_URL = `${ENDPOINT}/api/lud16/operator/verify/${'f'.repeat(64)}`

const invoiceResponse = () => ({
  success: true,
  message: 'Pay to claim',
  id: 'inv1',
  bolt11: 'lnbc210n1abc',
  paymentHash: 'f'.repeat(64),
  amountSats: 21,
  verify: VERIFY_URL,
  expiresAt: new Date(Date.now() + 60_000).toISOString()
})

let flowRef: ClaimAddressState | null = null
let authRef: ReturnType<typeof useAuth> | null = null

function ClaimProbe() {
  authRef = useAuth()
  flowRef = useClaimAddress({ onCreated: onCreatedSpy })
  return (
    <div>
      <span data-testid="step">{flowRef.step}</span>
      <span data-testid="claimed">{flowRef.claimedAddress ?? 'none'}</span>
      <span data-testid="error">{flowRef.error ?? 'none'}</span>
    </div>
  )
}

const onCreatedSpy = vi.fn()

async function renderLoggedIn() {
  server.use(
    http.get(`${ENDPOINT}/api/settings`, () =>
      HttpResponse.json({ domain: 'instance.test' })
    )
  )
  const view = renderWithProvider(<ClaimProbe />)
  const { nsec } = generateSigner()
  await act(() => authRef!.loginWithNsec(nsec))
  return view
}

describe('useClaimAddress', () => {
  beforeEach(() => {
    StubEventSource.reset()
    onCreatedSpy.mockClear()
    flowRef = null
    authRef = null
  })

  it('claims directly on the free path', async () => {
    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json({ username: 'alice', mode: 'IDLE' })
      )
    )
    await renderLoggedIn()

    act(() => flowRef!.setUsername('alice'))
    await act(() => flowRef!.handleSubmit())

    expect(screen.getByTestId('step').textContent).toBe('success')
    expect(screen.getByTestId('claimed').textContent).toBe(
      'alice@instance.test'
    )
    expect(onCreatedSpy).toHaveBeenCalledWith('alice@instance.test')
  })

  it('runs the paid path end to end: 402 → QR → settle → claim', async () => {
    let verifyCalls = 0
    let claimBody: unknown = null
    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json(
          { error: { message: 'Payment required', code: 'PAYMENT_REQUIRED' } },
          { status: 402 }
        )
      ),
      http.post(`${ENDPOINT}/api/invoices`, () =>
        HttpResponse.json(invoiceResponse())
      ),
      http.get(VERIFY_URL, () => {
        verifyCalls += 1
        return verifyCalls < 2
          ? HttpResponse.json({ settled: false })
          : HttpResponse.json({ settled: true, preimage: PREIMAGE })
      }),
      http.post(`${ENDPOINT}/api/invoices/inv1/claim`, async ({ request }) => {
        claimBody = await request.json()
        return HttpResponse.json({
          success: true,
          lightningAddress: 'alice@instance.test'
        })
      })
    )
    await renderLoggedIn()

    act(() => flowRef!.setUsername('alice'))
    await act(() => flowRef!.handleSubmit())

    // 402 branched into the payment step with the invoice ready for a QR.
    expect(screen.getByTestId('step').textContent).toBe('payment')
    expect(flowRef!.invoice?.bolt11).toBe('lnbc210n1abc')
    // The QR stays recoverable across a refresh.
    expect(sessionStorage.getItem('lawallet:pending-invoice')).toContain('inv1')

    // First poll tick fires immediately (settled: false); the second poll is
    // 3s out — the manual "I've paid" check covers it deterministically.
    await waitFor(() => expect(verifyCalls).toBeGreaterThanOrEqual(1))
    await act(() => flowRef!.handleManualCheck())

    await waitFor(() =>
      expect(screen.getByTestId('step').textContent).toBe('success')
    )
    expect(claimBody).toEqual({ preimage: PREIMAGE })
    expect(screen.getByTestId('claimed').textContent).toBe(
      'alice@instance.test'
    )
    expect(sessionStorage.getItem('lawallet:pending-invoice')).toBeNull()
    expect(onCreatedSpy).toHaveBeenCalledWith('alice@instance.test')
  })

  it('surfaces half-configured paid mode as an error and stays put', async () => {
    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json(
          { error: { message: 'Payment required', code: 'PAYMENT_REQUIRED' } },
          { status: 402 }
        )
      ),
      http.post(`${ENDPOINT}/api/invoices`, () =>
        HttpResponse.json({ free: true })
      )
    )
    await renderLoggedIn()

    act(() => flowRef!.setUsername('alice'))
    await act(() => flowRef!.handleSubmit())

    expect(screen.getByTestId('step').textContent).toBe('username')
    expect(screen.getByTestId('error').textContent).toContain(
      'configured but incomplete'
    )
  })

  it('restores a pending invoice after a remount and resumes', async () => {
    server.use(
      http.get(VERIFY_URL, () => HttpResponse.json({ settled: false }))
    )
    const saved = { ...invoiceResponse(), username: 'alice' }
    sessionStorage.setItem('lawallet:pending-invoice', JSON.stringify(saved))

    await renderLoggedIn()

    await waitFor(() =>
      expect(screen.getByTestId('step').textContent).toBe('payment')
    )
    expect(flowRef!.username).toBe('alice')
    expect(flowRef!.invoice?.id).toBe('inv1')
  })
})
