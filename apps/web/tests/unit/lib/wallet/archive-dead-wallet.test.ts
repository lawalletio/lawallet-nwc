import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

const fireAndForgetMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { NWC_WALLET_DEAD: 'nwc.wallet_dead' },
  logActivity: {
    fireAndForget: (...args: unknown[]) => fireAndForgetMock(...args)
  }
}))

const clearPrimaryWalletLinkMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/wallet/primary-wallet', () => ({
  clearPrimaryWalletLinkToWallet: clearPrimaryWalletLinkMock
}))

import {
  ARCHIVE_IDLE_MS,
  archiveDeadWallet,
  meetsIdleArchiveWindow,
  type WalletDeadEvent
} from '@/lib/wallet/archive-dead-wallet'

const HOUR = 3600

function walletDead(overrides: Partial<WalletDeadEvent> = {}): WalletDeadEvent {
  return {
    type: 'wallet_dead',
    eventKey: 'dead-1',
    walletId: 'wallet-1',
    receivedAt: Date.now(),
    unresponsiveSeconds: 48 * HOUR,
    relaysConnected: false,
    reason: 'warmup_failed',
    lastState: 'error',
    everReady: false,
    ...overrides
  }
}

function remoteWallet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wallet-1',
    userId: 'user-1',
    status: 'ACTIVE',
    config: { provider: 'nwc' },
    name: 'My Alby',
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  fireAndForgetMock.mockClear()
  clearPrimaryWalletLinkMock.mockClear()
})

describe('meetsIdleArchiveWindow', () => {
  it('is the 48h product rule, to the second', () => {
    expect(ARCHIVE_IDLE_MS).toBe(48 * 60 * 60 * 1000)
    expect(meetsIdleArchiveWindow(48 * HOUR)).toBe(true)
    expect(meetsIdleArchiveWindow(48 * HOUR - 1)).toBe(false)
    expect(meetsIdleArchiveWindow(47 * HOUR)).toBe(false)
    expect(meetsIdleArchiveWindow(72 * HOUR)).toBe(true)
  })
})

describe('archiveDeadWallet — the 48h idle rule', () => {
  it('archives a wallet whose NWC warm-up never succeeded', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet() as never
    )
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1
    } as never)

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('archived')
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wallet-1', status: 'ACTIVE' },
        data: expect.objectContaining({
          status: 'DEAD',
          diedReason: 'warmup_failed',
          isDefault: false
        })
      })
    )
    // The wallet can no longer back the account's primary address.
    expect(clearPrimaryWalletLinkMock).toHaveBeenCalledWith(
      'user-1',
      'wallet-1',
      expect.anything()
    )
  })

  it('archives an idle wallet regardless of provider (product rule)', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet({ config: { provider: 'nwc' } }) as never
    )
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1
    } as never)

    await expect(
      archiveDeadWallet(
        walletDead({
          reason: 'idle',
          everReady: true,
          unresponsiveSeconds: 72 * HOUR
        })
      )
    ).resolves.toBe('archived')
  })

  it('refuses an idle report that has not cleared 48h', async () => {
    await expect(
      archiveDeadWallet(
        walletDead({ reason: 'idle', unresponsiveSeconds: 47 * HOUR })
      )
    ).resolves.toBe('ignored')
    // Web owns the rule: it never even looks the wallet up.
    expect(prismaMock.remoteWallet.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a warmup_failed report that has not cleared 48h', async () => {
    await expect(
      archiveDeadWallet(walletDead({ unresponsiveSeconds: 3 * HOUR }))
    ).resolves.toBe('ignored')
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('is idempotent for an already-archived wallet', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet({ status: 'DEAD' }) as never
    )

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('noop')
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('treats a lost race as a no-op', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet() as never
    )
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 0
    } as never)

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('noop')
    expect(fireAndForgetMock).not.toHaveBeenCalled()
  })
})

describe('archiveDeadWallet — probe-confirmed death', () => {
  const unresponsive = walletDead({
    reason: 'unresponsive',
    relaysConnected: true,
    everReady: true,
    lastState: 'ready',
    unresponsiveSeconds: 4 * HOUR
  })

  it('archives an LNCurl wallet after a few hours of confirmed silence', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet({ config: { provider: 'lncurl' } }) as never
    )
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1
    } as never)

    await expect(archiveDeadWallet(unresponsive)).resolves.toBe('archived')
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ diedReason: 'unresponsive' })
      })
    )
  })

  it("leaves the user's own NWC alone on the short probe signal", async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet({ config: { provider: 'nwc' } }) as never
    )

    await expect(archiveDeadWallet(unresponsive)).resolves.toBe('ignored')
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a probe-confirmed report whose relays were down', async () => {
    await expect(
      archiveDeadWallet({ ...unresponsive, relaysConnected: false })
    ).resolves.toBe('ignored')
    expect(prismaMock.remoteWallet.findUnique).not.toHaveBeenCalled()
  })
})

describe('archiveDeadWallet — the LUD-16 proxy wallet', () => {
  it('archives the proxy config when no RemoteWallet owns the id', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )
    vi.mocked(prismaMock.proxyServiceConfig.findFirst).mockResolvedValue({
      id: 'default',
      archivedAt: null,
      lastListenerSeenAt: null
    } as never)
    vi.mocked(prismaMock.proxyServiceConfig.updateMany).mockResolvedValue({
      count: 1
    } as never)

    await expect(
      archiveDeadWallet(
        walletDead({ walletId: '0f6f6f2a-8f7d-4f2e-9d3a-3e6f1a2b4c5d' })
      )
    ).resolves.toBe('archived')
    expect(prismaMock.proxyServiceConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'default', archivedAt: null },
        data: expect.objectContaining({
          archivedReason: 'warmup_failed',
          // New intake stops; outstanding settlements still finish.
          enabled: false
        })
      })
    )
  })

  it('is idempotent once the proxy wallet is archived', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )
    vi.mocked(prismaMock.proxyServiceConfig.findFirst).mockResolvedValue({
      id: 'default',
      archivedAt: new Date(),
      lastListenerSeenAt: null
    } as never)

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('noop')
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it("refuses when web's own record shows the proxy wallet paid recently", async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )
    vi.mocked(prismaMock.proxyServiceConfig.findFirst).mockResolvedValue({
      id: 'default',
      archivedAt: null,
      lastListenerSeenAt: new Date(Date.now() - 60_000)
    } as never)

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('ignored')
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it('reports an unknown wallet id instead of silently succeeding', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )
    vi.mocked(prismaMock.proxyServiceConfig.findFirst).mockResolvedValue(
      null as never
    )

    await expect(archiveDeadWallet(walletDead())).resolves.toBe(
      'unknown_wallet'
    )
  })
})
