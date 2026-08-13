import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const { listenerNwcRequest, resolveListenerBridge, getServerNwcClient, captureForwardingReceipt } =
  vi.hoisted(() => ({
    listenerNwcRequest: vi.fn(),
    resolveListenerBridge: vi.fn(),
    getServerNwcClient: vi.fn(),
    captureForwardingReceipt: vi.fn()
  }))

vi.mock('@/lib/wallet/drivers/listener-transport', async importActual => ({
  ...(await importActual<
    typeof import('@/lib/wallet/drivers/listener-transport')
  >()),
  listenerNwcRequest,
  resolveListenerBridge
}))
vi.mock('@/lib/wallet/drivers/nwc-client-cache', () => ({ getServerNwcClient }))
vi.mock('@/lib/wallet/remote-wallet-vault', () => ({
  decryptRemoteWalletConfig: vi.fn(() => ({
    connectionString: 'nostr+walletconnect://test'
  }))
}))
vi.mock('@/lib/remote-wallet-forwarding/service', () => ({
  captureForwardingReceipt
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { sweepMissedPayments } from '@/lib/remote-wallet-forwarding/capture-sweep'
import { ListenerUnavailableError } from '@/lib/wallet/drivers/listener-transport'

// The generated client types `findMany` by its `select` subset, so the mock is
// narrowed once here instead of casting at every call site.
const receiveAction = prismaMock.remoteWalletReceiveAction as unknown as {
  findMany: Mock
  update: Mock
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const hash = (char: string) => char.repeat(64)

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    remoteWalletId: 'wallet-1',
    enabledAt: new Date(Date.now() - 2 * HOUR),
    lastSweepAt: null,
    remoteWallet: {
      id: 'wallet-1',
      type: 'NWC',
      config: { connectionString: 'sealed' }
    },
    ...overrides
  }
}

function settled(overrides: Record<string, unknown> = {}) {
  return {
    type: 'incoming',
    amount: 100_000,
    payment_hash: hash('a'),
    invoice: 'lnbc1source',
    settled_at: Math.floor((Date.now() - HOUR) / 1000),
    ...overrides
  }
}

/** The `from`/`until` window handed to the wallet on the single sweep call. */
function requestedWindow() {
  const params = listenerNwcRequest.mock.calls[0][1].params as {
    from: number
    until: number
  }
  return params
}

describe('sweepMissedPayments', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
    resolveListenerBridge.mockResolvedValue({ enabled: true, url: 'http://listener' })
    listenerNwcRequest.mockResolvedValue({ transactions: [] })
    captureForwardingReceipt.mockResolvedValue('receipt-1')
    receiveAction.findMany.mockResolvedValue([])
    receiveAction.update.mockResolvedValue({})
  })

  it('captures a settled payment the webhook never delivered', async () => {
    receiveAction.findMany.mockResolvedValue([action()])
    listenerNwcRequest.mockResolvedValue({ transactions: [settled()] })

    const recovered = await sweepMissedPayments()

    expect(recovered).toBe(1)
    expect(captureForwardingReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'wallet-1',
        recovered: true,
        payment: expect.objectContaining({
          paymentHash: hash('a'),
          amountMsats: 100_000
        })
      })
    )
  })

  it('derives the same eventKey the listener would, so a live delivery cannot double up', async () => {
    receiveAction.findMany.mockResolvedValue([action()])
    listenerNwcRequest.mockResolvedValue({ transactions: [settled()] })

    await sweepMissedPayments()

    const expected = createHash('sha256')
      .update(`wallet-1|payment_received|${hash('a')}`)
      .digest('hex')
    expect(captureForwardingReceipt.mock.calls[0][0].eventKey).toBe(expected)
  })

  it('counts an already-captured payment as nothing recovered', async () => {
    receiveAction.findMany.mockResolvedValue([action()])
    listenerNwcRequest.mockResolvedValue({ transactions: [settled()] })
    captureForwardingReceipt.mockResolvedValue(null)

    await expect(sweepMissedPayments()).resolves.toBe(0)
  })

  it('skips outgoing, unsettled, and malformed rows', async () => {
    receiveAction.findMany.mockResolvedValue([action()])
    listenerNwcRequest.mockResolvedValue({
      transactions: [
        settled({ type: 'outgoing', payment_hash: hash('b') }),
        settled({ settled_at: null, payment_hash: hash('c') }),
        settled({ payment_hash: 'not-a-hash' }),
        settled({ payment_hash: undefined })
      ]
    })

    await expect(sweepMissedPayments()).resolves.toBe(0)
    expect(captureForwardingReceipt).not.toHaveBeenCalled()
  })

  it('scans from enabledAt on the first sweep', async () => {
    const enabledAt = new Date(Date.now() - 3 * HOUR)
    receiveAction.findMany.mockResolvedValue([
      action({ enabledAt, lastSweepAt: null })
    ])

    await sweepMissedPayments()

    expect(requestedWindow().from).toBe(Math.floor(enabledAt.getTime() / 1000))
  })

  it('never reaches further back than seven days', async () => {
    receiveAction.findMany.mockResolvedValue([
      action({ enabledAt: new Date(Date.now() - 30 * DAY), lastSweepAt: null })
    ])

    await sweepMissedPayments()

    const floorMs = requestedWindow().from * 1000
    expect(floorMs).toBeGreaterThan(Date.now() - 7 * DAY - 5000)
    expect(floorMs).toBeLessThanOrEqual(Date.now() - 7 * DAY + 5000)
  })

  it('re-scans one hour behind the cursor to absorb settle-time skew', async () => {
    const lastSweepAt = new Date(Date.now() - 10 * 60 * 1000)
    receiveAction.findMany.mockResolvedValue([
      action({ enabledAt: new Date(Date.now() - 30 * DAY), lastSweepAt })
    ])

    await sweepMissedPayments()

    expect(requestedWindow().from).toBe(
      Math.floor((lastSweepAt.getTime() - HOUR) / 1000)
    )
  })

  it('falls back to the direct relay when the listener bridge is the broken part', async () => {
    receiveAction.findMany.mockResolvedValue([action()])
    listenerNwcRequest.mockRejectedValue(
      new ListenerUnavailableError('bridge down')
    )
    const listTransactions = vi.fn().mockResolvedValue({
      transactions: [settled()]
    })
    getServerNwcClient.mockResolvedValue({ listTransactions })

    await expect(sweepMissedPayments()).resolves.toBe(1)
    expect(listTransactions).toHaveBeenCalled()
  })

  it('advances the cursor even when nothing was recovered', async () => {
    receiveAction.findMany.mockResolvedValue([action()])

    await sweepMissedPayments()

    expect(receiveAction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'action-1' },
        data: { lastSweepAt: expect.any(Date) }
      })
    )
  })

  it('lets one unsweepable wallet not stop the others', async () => {
    receiveAction.findMany.mockResolvedValue([
      action({ id: 'action-1', remoteWalletId: 'wallet-1' }),
      action({ id: 'action-2', remoteWalletId: 'wallet-2' })
    ])
    listenerNwcRequest
      .mockRejectedValueOnce(new Error('wallet exploded'))
      .mockResolvedValueOnce({ transactions: [settled()] })

    await expect(sweepMissedPayments()).resolves.toBe(1)
  })

  it('throttles by cursor age unless forced', async () => {
    await sweepMissedPayments()
    expect(
      receiveAction.findMany.mock.calls[0][0].where.OR
    ).toBeDefined()

    vi.clearAllMocks()
    receiveAction.findMany.mockResolvedValue([])
    await sweepMissedPayments({ walletIds: ['wallet-1'], force: true })
    const where = receiveAction.findMany.mock.calls[0][0]
      .where as Record<string, unknown>
    expect(where.OR).toBeUndefined()
    expect(where.remoteWalletId).toEqual({ in: ['wallet-1'] })
  })
})
