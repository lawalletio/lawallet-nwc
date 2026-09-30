import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createRemoteWalletFixture } from '@/tests/helpers/fixtures'

// Logger reads config at module load — stub both before importing the SUT.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    nwcVault: {
      secret: 'test-nwc-vault-secret-0123456789abcdef',
      enabled: true
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

// The network mint is exercised by lncurl.test.ts — here we stub it so the
// wallet-persistence logic is tested in isolation, deterministically.
const LNCURL_URI = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

vi.mock('@/lib/lncurl', () => ({
  createLncurlWallet: vi.fn(async () => ({
    connectionString: LNCURL_URI,
    mode: 'SEND_RECEIVE' as const
  })),
  DEFAULT_LNCURL_SERVER: 'https://lncurl.lol/'
}))

import {
  courtesyReviveTarget,
  createLncurlRemoteWallet,
  findCourtesyReviveTarget,
  lncurlHealTarget,
  reviveDeadCourtesyWallet
} from '@/lib/wallet/lncurl-wallet'
import { createLncurlWallet } from '@/lib/lncurl'
import { getSettings } from '@/lib/settings'

const USER_ID = 'user-1'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // No existing wallet names by default → the default name is free.
  vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([] as never)
  const created = createRemoteWalletFixture({
    id: 'new-wallet',
    userId: USER_ID,
    isDefault: false
  })
  vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(created as never)
  vi.mocked(prismaMock.remoteWallet.findUniqueOrThrow).mockResolvedValue(
    created as never
  )
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
          nwcConfigEncryptedAt: expect.any(Date),
          config: expect.objectContaining({
            connectionString: expect.stringMatching(/^lwrw1:/),
            mode: 'SEND_RECEIVE',
            provider: 'lncurl'
          })
        })
      })
    )
  })

  it('synchronizes the display flag from the primary address after creation', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, isDefault: true },
      data: { isDefault: false }
    })
  })

  it('persists the lncurlServerUrl in config when a serverUrl is given', async () => {
    await createLncurlRemoteWallet({
      userId: USER_ID,
      serverUrl: 'https://my.lncurl.example'
    })

    expect(createLncurlWallet).toHaveBeenCalledWith('https://my.lncurl.example')
    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          config: expect.objectContaining({
            lncurlServerUrl: 'https://my.lncurl.example'
          })
        })
      })
    )
  })

  it('falls back to "LNCurl wallet 2" when "LNCurl wallet" is taken', async () => {
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([
      { name: 'LNCurl wallet' }
    ] as never)

    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'LNCurl wallet 2' })
      })
    )
  })

  it('honours an explicit name override', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID, name: 'My Curl' })

    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'My Curl' })
      })
    )
  })

  // ── re-provisioning (previousWalletId) ──────────────────────────────────

  it('re-points LightningAddress + Card bindings when previousWalletId is set', async () => {
    await createLncurlRemoteWallet({
      userId: USER_ID,
      previousWalletId: 'dead-wallet'
    })

    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, remoteWalletId: 'dead-wallet' },
      data: { remoteWalletId: 'new-wallet' }
    })
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, remoteWalletId: 'dead-wallet' },
      data: { remoteWalletId: 'new-wallet' }
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
      revokePrevious: true
    })

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dead-wallet', userId: USER_ID },
        data: expect.objectContaining({
          status: 'DEAD',
          diedAt: expect.any(Date)
        })
      })
    )
  })

  it('does NOT archive the previous wallet when revokePrevious is false', async () => {
    await createLncurlRemoteWallet({
      userId: USER_ID,
      previousWalletId: 'dead-wallet',
      revokePrevious: false
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
    vi.mocked(createLncurlWallet).mockRejectedValueOnce(
      new Error('LNCurl down')
    )

    await expect(createLncurlRemoteWallet({ userId: USER_ID })).rejects.toThrow(
      'LNCurl down'
    )
    expect(prismaMock.remoteWallet.create).not.toHaveBeenCalled()
  })

  it('uses an injected mint and does not call the provider again', async () => {
    await createLncurlRemoteWallet({
      userId: USER_ID,
      mint: { connectionString: LNCURL_URI, mode: 'SEND_RECEIVE' }
    })

    expect(createLncurlWallet).not.toHaveBeenCalled()
    expect(prismaMock.remoteWallet.create).toHaveBeenCalled()
  })

  it('binds the primary address inside the create transaction when isDefault is true', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst)
      .mockResolvedValueOnce({ username: 'alice' } as never)
      .mockResolvedValueOnce({
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'new-wallet'
      } as never)
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1
    } as never)

    const created = await createLncurlRemoteWallet({
      userId: USER_ID,
      isDefault: true
    })

    expect(created.isDefault).toBe(true)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'alice' },
      data: {
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWalletId: 'new-wallet'
      }
    })
  })

  it('does not bind the primary address unless isDefault is requested', async () => {
    await createLncurlRemoteWallet({ userId: USER_ID })

    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
  })
})

describe('lncurlHealTarget', () => {
  const ON = { lncurl_enabled: 'true', lncurl_auto_recreate: 'true' }
  const CREATE_ONLY = { lncurl_enabled: 'true', lncurl_auto_create: 'true' }
  const deadLncurl = {
    id: 'w-dead',
    status: 'DEAD' as const,
    config: { provider: 'lncurl' }
  }
  const deadOther = {
    id: 'w-dead',
    status: 'DEAD' as const,
    config: { provider: 'alby' }
  }
  const activeLncurl = {
    id: 'w-active',
    status: 'ACTIVE' as const,
    config: { provider: 'lncurl' }
  }

  it('returns null when lncurl is disabled', () => {
    expect(
      lncurlHealTarget(
        { mode: 'CUSTOM_NWC', boundWallet: null },
        { lncurl_enabled: 'false', lncurl_auto_recreate: 'true' }
      )
    ).toBeNull()
  })

  it('returns null when neither auto-create nor auto-recreate is on', () => {
    expect(
      lncurlHealTarget(
        { mode: 'CUSTOM_NWC', boundWallet: null },
        {
          lncurl_enabled: 'true',
          lncurl_auto_create: 'false',
          lncurl_auto_recreate: 'false'
        }
      )
    ).toBeNull()
  })

  it('auto-create alone provisions a first wallet (no-wallet case)', () => {
    expect(
      lncurlHealTarget({ mode: 'CUSTOM_NWC', boundWallet: null }, CREATE_ONLY)
    ).toEqual({ previousWalletId: null })
  })

  it('auto-create alone does NOT recreate a dead wallet (recreation needs auto-recreate)', () => {
    expect(
      lncurlHealTarget(
        { mode: 'CUSTOM_NWC', boundWallet: deadLncurl },
        CREATE_ONLY
      )
    ).toBeNull()
  })

  it('CUSTOM_NWC with no bound wallet → create fresh (previousWalletId null)', () => {
    expect(
      lncurlHealTarget({ mode: 'CUSTOM_NWC', boundWallet: null }, ON)
    ).toEqual({ previousWalletId: null })
  })

  it('DEFAULT_NWC with a DEAD lncurl default → recreate that wallet', () => {
    expect(
      lncurlHealTarget({ mode: 'CUSTOM_NWC', boundWallet: deadLncurl }, ON)
    ).toEqual({ previousWalletId: 'w-dead' })
  })

  it('never replaces a DEAD non-LNCurl wallet', () => {
    expect(
      lncurlHealTarget({ mode: 'CUSTOM_NWC', boundWallet: deadOther }, ON)
    ).toBeNull()
  })

  it('never auto-heals IDLE or ALIAS addresses', () => {
    expect(lncurlHealTarget({ mode: 'IDLE', boundWallet: null }, ON)).toBeNull()
    expect(
      lncurlHealTarget({ mode: 'ALIAS', boundWallet: null }, ON)
    ).toBeNull()
  })

  it('CUSTOM_NWC keys off the wallet the address is bound to', () => {
    expect(
      lncurlHealTarget({ mode: 'CUSTOM_NWC', boundWallet: deadLncurl }, ON)
    ).toEqual({ previousWalletId: 'w-dead' })
  })
})

describe('courtesyReviveTarget', () => {
  const ON = { lncurl_enabled: 'true', lncurl_auto_recreate: 'true' }
  const deadLncurl = {
    id: 'w-dead',
    status: 'DEAD' as const,
    config: { provider: 'lncurl' }
  }
  const deadOther = {
    id: 'w-other',
    status: 'DEAD' as const,
    config: { provider: 'alby' }
  }

  it('replaces a DEAD LNCurl wallet the address is still bound to', () => {
    expect(
      courtesyReviveTarget(
        {
          mode: 'CUSTOM_NWC',
          boundWallet: deadLncurl,
          archivedCourtesy: null,
          hasActiveWallet: false
        },
        ON
      )
    ).toEqual({ previousWalletId: 'w-dead' })
  })

  it('replaces an archived courtesy wallet after the primary address was unlinked', () => {
    expect(
      courtesyReviveTarget(
        {
          mode: 'IDLE',
          boundWallet: null,
          archivedCourtesy: deadLncurl,
          hasActiveWallet: false
        },
        ON
      )
    ).toEqual({ previousWalletId: 'w-dead' })
  })

  it('does not replace a non-LNCurl wallet or an address that already has an active wallet', () => {
    expect(
      courtesyReviveTarget(
        {
          mode: 'CUSTOM_NWC',
          boundWallet: deadOther,
          archivedCourtesy: deadLncurl,
          hasActiveWallet: false
        },
        ON
      )
    ).toBeNull()
    expect(
      courtesyReviveTarget(
        {
          mode: 'IDLE',
          boundWallet: null,
          archivedCourtesy: deadLncurl,
          hasActiveWallet: true
        },
        ON
      )
    ).toBeNull()
    expect(
      courtesyReviveTarget(
        {
          mode: 'ALIAS',
          boundWallet: null,
          archivedCourtesy: deadLncurl,
          hasActiveWallet: false
        },
        ON
      )
    ).toBeNull()
    expect(
      courtesyReviveTarget(
        {
          mode: 'IDLE',
          boundWallet: null,
          archivedCourtesy: deadLncurl,
          hasActiveWallet: false
        },
        { lncurl_enabled: 'true', lncurl_auto_recreate: 'false' }
      )
    ).toBeNull()
  })
})

describe('reviveDeadCourtesyWallet', () => {
  const deadWallet = {
    id: 'dead-wallet',
    status: 'DEAD' as const,
    config: { provider: 'lncurl' }
  }

  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_enabled: 'true',
      lncurl_auto_recreate: 'true',
      lncurl_server_url: 'https://my.lncurl.example'
    })
    vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue({
      count: 1
    } as never)
  })

  it('mints a replacement, rebinds the primary address, and tombstones the dead wallet', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst)
      .mockResolvedValueOnce({
        mode: 'CUSTOM_NWC',
        remoteWallet: deadWallet
      } as never)
      .mockResolvedValueOnce({ username: 'alice' } as never)
      .mockResolvedValueOnce({
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'new-wallet'
      } as never)

    const created = await reviveDeadCourtesyWallet(USER_ID)

    expect(created?.id).toBe('new-wallet')
    expect(createLncurlWallet).toHaveBeenCalledWith('https://my.lncurl.example')
    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, remoteWalletId: 'dead-wallet' },
      data: { remoteWalletId: 'new-wallet' }
    })
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'alice' },
      data: {
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWalletId: 'new-wallet'
      }
    })
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dead-wallet', userId: USER_ID },
        data: expect.objectContaining({ status: 'DEAD' })
      })
    )
  })

  it('replaces a courtesy wallet after archival left the primary address IDLE', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst)
      .mockResolvedValueOnce({
        mode: 'IDLE',
        remoteWallet: null
      } as never)
      .mockResolvedValueOnce({ username: 'alice' } as never)
      .mockResolvedValueOnce({
        mode: 'CUSTOM_NWC',
        remoteWalletId: 'new-wallet'
      } as never)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockImplementation(
      (async (args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'ACTIVE') return null
        if (args?.where?.status === 'DEAD') return deadWallet
        return null
      }) as never
    )

    await reviveDeadCourtesyWallet(USER_ID)

    expect(createLncurlWallet).toHaveBeenCalledTimes(1)
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remoteWalletId: 'new-wallet' })
      })
    )
  })

  it('does not mint when the dead wallet is not LNCurl', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'CUSTOM_NWC',
      remoteWallet: {
        id: 'alby',
        status: 'DEAD',
        config: { provider: 'alby' }
      }
    } as never)

    await expect(findCourtesyReviveTarget(USER_ID)).resolves.toBeNull()
    expect(createLncurlWallet).not.toHaveBeenCalled()
  })

  it('does not mint when auto-recreate is off', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_enabled: 'true',
      lncurl_auto_recreate: 'false'
    })

    await expect(reviveDeadCourtesyWallet(USER_ID)).resolves.toBeNull()
    expect(prismaMock.lightningAddress.findFirst).not.toHaveBeenCalled()
  })
})
