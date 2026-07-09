import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createRemoteWalletFixture } from '@/tests/helpers/fixtures'

// Logger reads config at module load — stub both before importing the SUT.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
}))

// The network mint is exercised by lncurl.test.ts — here we stub it so the
// wallet-persistence logic is tested in isolation, deterministically.
const LNCURL_URI = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`
vi.mock('@/lib/lncurl', () => ({
  createLncurlWallet: vi.fn(async () => ({
    connectionString: LNCURL_URI,
    mode: 'SEND_RECEIVE' as const,
  })),
  DEFAULT_LNCURL_SERVER: 'https://lncurl.lol/',
}))

import {
  createLncurlRemoteWallet,
  lncurlHealTarget,
} from '@/lib/wallet/lncurl-wallet'
import { createLncurlWallet } from '@/lib/lncurl'

const USER_ID = 'user-1'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // No existing wallet names by default → the default name is free.
  vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([] as never)
  const created = createRemoteWalletFixture({
    id: 'new-wallet',
    userId: USER_ID,
    isDefault: false,
  })
  vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(created as never)
  vi.mocked(prismaMock.remoteWallet.findUniqueOrThrow).mockResolvedValue(created as never)
})

describe('createLncurlRemoteWallet', () => {
  it('mints a wallet then creates it as a non-primary LNCurl-tagged RemoteWallet', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(createLncurlWallet).toHaveBeenCalledTimes(1)
    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          name: 'LNCurl wallet',
          type: 'NWC',
          status: 'ACTIVE',
          isDefault: false,
          config: expect.objectContaining({
            connectionString: LNCURL_URI,
            mode: 'SEND_RECEIVE',
            provider: 'lncurl',
          }),
        }),
      }),
    )
  })

  it('synchronizes the display flag from the primary address after creation', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isDefault: true },
      data: { isDefault: false },
    })
  })

  it('persists the lncurlServerUrl in config when a serverUrl is given', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID, serverUrl: 'https://my.lncurl.example' })

    expect(createLncurlWallet).toHaveBeenCalledWith('https://my.lncurl.example')
    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          config: expect.objectContaining({
            lncurlServerUrl: 'https://my.lncurl.example',
          }),
        }),
      }),
    )
  })

  it('falls back to "LNCurl wallet 2" when "LNCurl wallet" is taken', async () => {
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([
      { name: 'LNCurl wallet' },
    ] as never)

    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'LNCurl wallet 2' }),
      }),
    )
  })

  it('honours an explicit name override', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID, name: 'My Curl' })

    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'My Curl' }) }),
    )
  })

  // ── re-provisioning (previousWalletId) ──────────────────────────────────

  it('re-points LightningAddress + Card bindings when previousWalletId is set', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID, previousWalletId: 'dead-wallet' })

    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, remoteWalletId: 'dead-wallet' },
      data: { remoteWalletId: 'new-wallet' },
    })
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, remoteWalletId: 'dead-wallet' },
      data: { remoteWalletId: 'new-wallet' },
    })
  })

  it('does NOT touch bindings when there is no previousWalletId', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(prismaMock.lightningAddress.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
  })

  it('archives the previous wallet as DEAD (with diedAt) when revokePrevious is true', async () => {
    await createLncurlRemoteWallet({
      userId: USER_ID,
      previousWalletId: 'dead-wallet',
      revokePrevious: true,
    })

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dead-wallet', userId: USER_ID },
        data: expect.objectContaining({ status: 'DEAD', diedAt: expect.any(Date) }),
      }),
    )
  })

  it('does NOT archive the previous wallet when revokePrevious is false', async () => {
    await createLncurlRemoteWallet({
      userId: USER_ID,
      previousWalletId: 'dead-wallet',
      revokePrevious: false,
    })

    const archived = vi
      .mocked(prismaMock.remoteWallet.updateMany)
      .mock.calls.some(([arg]: any[]) => arg?.data?.status === 'DEAD')
    expect(archived).toBe(false)
  })

  it('runs the whole write inside a single $transaction', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
  })

  it('propagates a mint failure without writing anything', async () => {
    vi.mocked(createLncurlWallet).mockRejectedValueOnce(new Error('LNCurl down'))

    await expect(createLncurlRemoteWallet({ userId: USER_ID })).rejects.toThrow('LNCurl down')
    expect(prismaMock.remoteWallet.create).not.toHaveBeenCalled()
  })
})

describe('lncurlHealTarget', () => {
  const ON = { lncurl_enabled: 'true', lncurl_auto_recreate: 'true' }
  const CREATE_ONLY = { lncurl_enabled: 'true', lncurl_auto_create: 'true' }
  const deadLncurl = { id: 'w-dead', status: 'DEAD' as const, config: { provider: 'lncurl' } }
  const deadOther = { id: 'w-dead', status: 'DEAD' as const, config: { provider: 'alby' } }
  const activeLncurl = { id: 'w-active', status: 'ACTIVE' as const, config: { provider: 'lncurl' } }

  it('returns null when lncurl is disabled', () => {
    expect(
      lncurlHealTarget(
        { mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: null },
        { lncurl_enabled: 'false', lncurl_auto_recreate: 'true' },
      ),
    ).toBeNull()
  })

  it('returns null when neither auto-create nor auto-recreate is on', () => {
    expect(
      lncurlHealTarget(
        { mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: null },
        { lncurl_enabled: 'true', lncurl_auto_create: 'false', lncurl_auto_recreate: 'false' },
      ),
    ).toBeNull()
  })

  it('auto-create alone provisions a first wallet (no-wallet case)', () => {
    expect(
      lncurlHealTarget({ mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: null }, CREATE_ONLY),
    ).toEqual({ previousWalletId: null })
  })

  it('auto-create alone does NOT recreate a dead wallet (recreation needs auto-recreate)', () => {
    expect(
      lncurlHealTarget({ mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: deadLncurl }, CREATE_ONLY),
    ).toBeNull()
  })

  it('DEFAULT_NWC with no default wallet → create fresh (previousWalletId null)', () => {
    expect(
      lncurlHealTarget({ mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: null }, ON),
    ).toEqual({ previousWalletId: null })
  })

  it('CUSTOM_NWC with no bound wallet → create fresh (previousWalletId null)', () => {
    expect(
      lncurlHealTarget({ mode: 'CUSTOM_NWC', boundWallet: null, defaultWallet: activeLncurl }, ON),
    ).toEqual({ previousWalletId: null })
  })

  it('DEFAULT_NWC with a DEAD lncurl default → recreate that wallet', () => {
    expect(
      lncurlHealTarget({ mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: deadLncurl }, ON),
    ).toEqual({ previousWalletId: 'w-dead' })
  })

  it('never replaces a DEAD non-LNCurl wallet', () => {
    expect(
      lncurlHealTarget({ mode: 'DEFAULT_NWC', boundWallet: null, defaultWallet: deadOther }, ON),
    ).toBeNull()
  })

  it('never auto-heals IDLE or ALIAS addresses', () => {
    expect(
      lncurlHealTarget({ mode: 'IDLE', boundWallet: null, defaultWallet: null }, ON),
    ).toBeNull()
    expect(
      lncurlHealTarget({ mode: 'ALIAS', boundWallet: null, defaultWallet: null }, ON),
    ).toBeNull()
  })

  it('CUSTOM_NWC keys off the bound wallet, not the default', () => {
    // Bound wallet is a dead lncurl; default is an unrelated active wallet.
    expect(
      lncurlHealTarget(
        { mode: 'CUSTOM_NWC', boundWallet: deadLncurl, defaultWallet: activeLncurl },
        ON,
      ),
    ).toEqual({ previousWalletId: 'w-dead' })
  })
})
