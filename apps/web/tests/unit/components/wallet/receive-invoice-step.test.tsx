import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReceiveInvoiceStep } from '@/components/wallet/receive/invoice-step'
import { BoltcardPayError } from '@/lib/client/boltcard-pay'
import type { NwcTransactionEvent } from '@/lib/client/use-nwc-balance'
import { receiveActions, resetAllFlows } from '@/lib/client/wallet-flow-store'

const replaceMock = vi.hoisted(() => vi.fn())
const payMock = vi.hoisted(() => vi.fn())
const txListener = vi.hoisted(() => ({
  current: null as ((tx: NwcTransactionEvent) => void) | null
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn()
  })
}))

vi.mock('@/components/wallet/nwc-provider', () => ({
  useWalletNwcTransactions: (listener: (tx: NwcTransactionEvent) => void) => {
    txListener.current = listener
  }
}))

vi.mock('@/lib/client/boltcard-pay', () => {
  class BoltcardPayError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'BoltcardPayError'
    }
  }
  return {
    BoltcardPayError,
    payDisplayedInvoiceFromCard: payMock
  }
})

const INVOICE = {
  bolt11: 'lnbc500n1displayedinvoice',
  paymentHash: 'ab'.repeat(32),
  amountSats: 500,
  description: 'Coffee',
  expiresAt: null
}

const CARD_URL = 'lnurlw://card.example/scan?p=AA&c=BB'

class FakeNDEFReader {
  static instances: FakeNDEFReader[] = []
  static scanError: unknown = null
  aborted = false
  private listeners = new Map<string, Set<(event: Event) => void>>()

  constructor() {
    FakeNDEFReader.instances.push(this)
  }

  scan(opts?: { signal?: AbortSignal }) {
    opts?.signal?.addEventListener('abort', () => {
      this.aborted = true
    })
    if (FakeNDEFReader.scanError)
      return Promise.reject(FakeNDEFReader.scanError)
    return Promise.resolve()
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  emitReading(records: Array<{ recordType: string; data?: Uint8Array }>) {
    const event = { message: { records } } as unknown as Event
    for (const listener of this.listeners.get('reading') ?? []) listener(event)
  }

  emitReadingError() {
    const event = new Event('readingerror')
    for (const listener of this.listeners.get('readingerror') ?? []) {
      listener(event)
    }
  }
}

function installReader() {
  FakeNDEFReader.instances = []
  FakeNDEFReader.scanError = null
  Object.assign(window, { NDEFReader: FakeNDEFReader })
}

function removeReader() {
  delete (window as unknown as { NDEFReader?: unknown }).NDEFReader
}

function latestReader() {
  const reader = FakeNDEFReader.instances.at(-1)
  if (!reader) throw new Error('NFC reader was not started')
  return reader
}

describe('ReceiveInvoiceStep BoltCard NFC', () => {
  beforeEach(() => {
    resetAllFlows()
    replaceMock.mockReset()
    payMock.mockReset()
    payMock.mockResolvedValue(undefined)
    txListener.current = null
    FakeNDEFReader.instances = []
    FakeNDEFReader.scanError = null
    removeReader()
    receiveActions.setInvoice(INVOICE)
  })

  afterEach(() => {
    removeReader()
    resetAllFlows()
  })

  it('shows a non-blocking unavailable state when Web NFC is missing', async () => {
    render(<ReceiveInvoiceStep />)

    expect(await screen.findByText('500')).toBeInTheDocument()
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()
    expect(
      screen.getByText(/NFC unavailable on this device/)
    ).toBeInTheDocument()
    expect(payMock).not.toHaveBeenCalled()
  })

  it('starts reading on mount and charges the displayed invoice', async () => {
    installReader()
    render(<ReceiveInvoiceStep />)

    expect(
      await screen.findByText('Hold a BoltCard to the back of the phone')
    ).toBeInTheDocument()

    latestReader().emitReading([
      { recordType: 'url', data: new TextEncoder().encode(CARD_URL) }
    ])

    expect(await screen.findByText('Card accepted')).toBeInTheDocument()
    expect(screen.queryByText('Waiting for payment…')).not.toBeInTheDocument()
    expect(payMock).toHaveBeenCalledTimes(1)
    expect(payMock).toHaveBeenCalledWith({
      cardUrl: CARD_URL,
      bolt11: INVOICE.bolt11,
      amountSats: 500
    })
    expect(latestReader().aborted).toBe(true)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('waits out the success animation, then opens the receive summary', async () => {
    installReader()
    render(<ReceiveInvoiceStep />)
    await screen.findByText('Hold a BoltCard to the back of the phone')
    latestReader().emitReading([
      { recordType: 'text', data: new TextEncoder().encode(CARD_URL) }
    ])
    await screen.findByText('Card accepted')

    await act(async () => {
      txListener.current?.({
        type: 'incoming',
        amountSats: 500,
        feesPaidSats: 0,
        description: 'Coffee',
        paymentHash: INVOICE.paymentHash,
        settledAt: 1_700_000_000_000
      })
    })
    expect(replaceMock).not.toHaveBeenCalled()

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1200))
    })
    expect(replaceMock).toHaveBeenCalledWith('/wallet/receive/summary')
  })

  it('opens the summary immediately when the invoice is paid over Lightning', async () => {
    render(<ReceiveInvoiceStep />)
    await screen.findByText(/NFC unavailable/)

    await act(async () => {
      txListener.current?.({
        type: 'incoming',
        amountSats: 500,
        feesPaidSats: 0,
        description: 'Coffee',
        paymentHash: INVOICE.paymentHash,
        settledAt: 1_700_000_000_000
      })
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(replaceMock).toHaveBeenCalledWith('/wallet/receive/summary')
  })

  it('shows a payment failure and accepts another tap', async () => {
    installReader()
    payMock.mockRejectedValueOnce(
      new BoltcardPayError(
        'This card can pay up to 10 sats. This invoice is 500 sats.'
      )
    )
    render(<ReceiveInvoiceStep />)
    await screen.findByText('Hold a BoltCard to the back of the phone')

    const reader = latestReader()
    reader.emitReading([
      { recordType: 'url', data: new TextEncoder().encode(CARD_URL) }
    ])

    expect(await screen.findByRole('alert')).toHaveTextContent(/up to 10 sats/)
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      screen.getByText('Hold a BoltCard to the back of the phone')
    ).toBeInTheDocument()

    payMock.mockResolvedValueOnce(undefined)
    reader.emitReading([
      { recordType: 'url', data: new TextEncoder().encode(CARD_URL) }
    ])
    expect(await screen.findByText('Card accepted')).toBeInTheDocument()
    expect(payMock).toHaveBeenCalledTimes(2)
  })

  it('explains an unreadable tag and a card that moved away', async () => {
    installReader()
    render(<ReceiveInvoiceStep />)
    await screen.findByText('Hold a BoltCard to the back of the phone')
    const reader = latestReader()

    reader.emitReading([
      { recordType: 'text', data: new TextEncoder().encode('hello') }
    ])
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no BoltCard link/
    )

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    reader.emitReadingError()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Hold it steady/)
  })

  it('asks for a gesture when the browser blocks an automatic scan', async () => {
    installReader()
    FakeNDEFReader.scanError = new DOMException('gesture', 'NotAllowedError')
    render(<ReceiveInvoiceStep />)

    expect(
      await screen.findByRole('button', { name: 'Allow NFC' })
    ).toBeInTheDocument()
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()

    FakeNDEFReader.scanError = null
    await userEvent.click(screen.getByRole('button', { name: 'Allow NFC' }))
    expect(
      await screen.findByText('Hold a BoltCard to the back of the phone')
    ).toBeInTheDocument()
  })

  it('stops the reader when the screen unmounts', async () => {
    installReader()
    const view = render(<ReceiveInvoiceStep />)
    await screen.findByText('Hold a BoltCard to the back of the phone')
    const reader = latestReader()
    view.unmount()
    expect(reader.aborted).toBe(true)
  })

  it('ignores a second tap while the first charge is in flight', async () => {
    installReader()
    let resolvePay: (() => void) | undefined
    payMock.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolvePay = resolve
        })
    )
    render(<ReceiveInvoiceStep />)
    await screen.findByText('Hold a BoltCard to the back of the phone')
    const reader = latestReader()
    const record = [
      { recordType: 'url', data: new TextEncoder().encode(CARD_URL) }
    ]
    reader.emitReading(record)
    reader.emitReading(record)
    expect(await screen.findByText('Charging the card…')).toBeInTheDocument()
    expect(payMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolvePay?.()
    })
    expect(await screen.findByText('Card accepted')).toBeInTheDocument()
  })
})
