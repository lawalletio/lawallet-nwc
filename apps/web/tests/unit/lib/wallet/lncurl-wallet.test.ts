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

import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'
import { createLncurlWallet } from '@/lib/lncurl'

const USER_ID = 'user-1'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // No existing wallet names by default → the default name is free.
  vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([] as never)
  vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(
    createRemoteWalletFixture({ id: 'new-wallet', userId: USER_ID, isDefault: true }) as never,
  )
})

describe('createLncurlRemoteWallet', () => {
  it('mints a wallet then creates it as the default LNCurl-tagged RemoteWallet', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(createLncurlWallet).toHaveBeenCalledTimes(1)
    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          name: 'LNCurl wallet',
          type: 'NWC',
          status: 'ACTIVE',
          isDefault: true,
          config: expect.objectContaining({
            connectionString: LNCURL_URI,
            mode: 'SEND_RECEIVE',
            provider: 'lncurl',
          }),
        }),
      }),
    )
  })

  it('clears the prior default before creating the new one', async () => {
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
