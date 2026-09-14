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
import { logger } from '@/lib/logger'

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

  it('refuses a wallet whose config records no provider at all', async () => {
    // A config that predates the provider field, or one that failed to parse,
    // must not be read as "disposable" — the probe signal only archives
    // wallets we know we minted.
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      remoteWallet({ config: null }) as never
    )

    await expect(archiveDeadWallet(unresponsive)).resolves.toBe('ignored')
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { walletId: 'wallet-1', provider: null },
      'nwc.wallet_dead_ignored_non_lncurl'
    )
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
        where: expect.objectContaining({ id: 'default', archivedAt: null }),
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

  it('treats a proxy archived mid-flight by another report as a no-op', async () => {
    // Both the sweep and an inline retry can carry the same report. The
    // second one finds `archivedAt: null` still true when it reads, and loses
    // the conditional update — no second activity entry, no second SSE nudge.
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )
    vi.mocked(prismaMock.proxyServiceConfig.findFirst).mockResolvedValue({
      id: 'default',
      archivedAt: null,
      lastListenerSeenAt: null
    } as never)
    vi.mocked(prismaMock.proxyServiceConfig.updateMany).mockResolvedValue({
      count: 0
    } as never)
    // Re-read shows it archived — the other report won.
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      archivedAt: new Date()
    } as never)

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('noop')
    expect(fireAndForgetMock).not.toHaveBeenCalled()
  })

  it('records the missing diagnostics as null when an older listener omits them', async () => {
    // `lastState` / `everReady` arrived with the idle path; a listener that
    // predates it sends neither, and the activity entry has to survive that.
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
        walletDead({
          reason: 'idle',
          relaysConnected: true,
          unresponsiveSeconds: 50 * HOUR,
          lastState: undefined,
          everReady: undefined
        })
      )
    ).resolves.toBe('archived')
    expect(fireAndForgetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'LUD-16 proxy wallet archived — no sign of life for ~50h',
        metadata: expect.objectContaining({ lastState: null, everReady: null })
      })
    )
  })

  // The proxy credential is the OPERATOR's Alby or self-hosted node — the same
  // class as a user's own NWC, which the probe path already refuses. A few hours
  // of `get_info` silence is a node that stopped answering probes, not a dead
  // wallet, and disabling LUD-16 intake for the whole deployment on that signal
  // is the worst possible false positive.
  it('refuses the short probe signal, whatever the wallet answered', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )

    await expect(
      archiveDeadWallet(
        walletDead({
          reason: 'unresponsive',
          relaysConnected: true,
          everReady: true,
          lastState: 'ready',
          unresponsiveSeconds: 4 * HOUR
        })
      )
    ).resolves.toBe('ignored')
    // Refused before web even looks the proxy config up.
    expect(prismaMock.proxyServiceConfig.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'wallet-1' }),
      'nwc.proxy_wallet_dead_ignored_probe_signal'
    )
  })

  it('still refuses the probe signal after days of silence', async () => {
    // A long-unresponsive probe report is not an idle report: only the listener's
    // own 48h rule (`idle` / `warmup_failed`) may archive the proxy.
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )

    await expect(
      archiveDeadWallet(
        walletDead({
          reason: 'unresponsive',
          relaysConnected: true,
          unresponsiveSeconds: 96 * HOUR
        })
      )
    ).resolves.toBe('ignored')
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it('archives a genuinely dead proxy once the 48h rule fires', async () => {
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
        walletDead({ reason: 'idle', unresponsiveSeconds: 50 * HOUR })
      )
    ).resolves.toBe('archived')
  })

  it('re-checks the contradiction inside the conditional update (TOCTOU)', async () => {
    // A payment webhook can land between the read and the write. The where
    // clause carries the same guard, so losing that race cannot disable a proxy
    // that just proved it works.
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

    await archiveDeadWallet(walletDead())
    const where = vi.mocked(prismaMock.proxyServiceConfig.updateMany).mock
      .calls[0][0].where as Record<string, unknown>
    expect(where.archivedAt).toBeNull()
    expect(where.OR).toEqual([
      { lastListenerSeenAt: null },
      { lastListenerSeenAt: { lte: expect.any(Date) } }
    ])
  })

  it('calls a lost conditional update `ignored` when nothing archived it', async () => {
    // count 0 with the row still un-archived means the contradiction guard
    // matched, not that another report won — the listener must keep watching.
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      null as never
    )
    vi.mocked(prismaMock.proxyServiceConfig.findFirst).mockResolvedValue({
      id: 'default',
      archivedAt: null,
      lastListenerSeenAt: null
    } as never)
    vi.mocked(prismaMock.proxyServiceConfig.updateMany).mockResolvedValue({
      count: 0
    } as never)
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      archivedAt: null
    } as never)

    await expect(archiveDeadWallet(walletDead())).resolves.toBe('ignored')
    expect(fireAndForgetMock).not.toHaveBeenCalled()
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
