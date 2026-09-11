import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createUserFixture,
  createRemoteWalletFixture
} from '@/tests/helpers/fixtures'

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
  withRequestLogging: (fn: unknown) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/wallet/lncurl-wallet', () => ({
  createLncurlRemoteWallet: vi.fn()
}))

// Activity log is fire-and-forget; stub so we don't pull in the event bus.
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { USER_SIGNUP: 'user.signup' },
  logActivity: { fireAndForget: vi.fn() }
}))

import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'

const PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // Default: a plain user row with no wallets — matches the create() include.
  vi.mocked(prismaMock.user.create).mockResolvedValue(
    createUserFixture({
      pubkey: PUBKEY,
      remoteWallets: []
    }) as never
  )
})

describe('createNewUser — LNCurl auto-create', () => {
  it('provisions a default LNCurl wallet when auto-create is on', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_auto_create: 'true',
      lncurl_server_url: 'https://my.lncurl.example'
    })
    const lncurlWallet = createRemoteWalletFixture({
      id: 'lncurl-1',
      isDefault: true
    })
    vi.mocked(createLncurlRemoteWallet).mockResolvedValue(lncurlWallet as never)

    const user = await createNewUser(PUBKEY)

    expect(createLncurlRemoteWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        serverUrl: 'https://my.lncurl.example'
      })
    )
    // The new wallet is attached as the user's default.
    expect((user as { remoteWallets: unknown[] }).remoteWallets).toEqual([
      lncurlWallet
    ])
  })

  it('does NOT auto-create when lncurl_auto_create is not "true"', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_auto_create: 'false'
    })

    await createNewUser(PUBKEY)

    expect(createLncurlRemoteWallet).not.toHaveBeenCalled()
  })

  it('swallows an LNCurl failure — signup still succeeds with no wallet', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      lncurl_auto_create: 'true'
    })
    vi.mocked(createLncurlRemoteWallet).mockRejectedValue(
      new Error('LNCurl down')
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const user = await createNewUser(PUBKEY)

    // The user record is returned despite the wallet provisioning failure.
    expect(user.id).toBeTruthy()
    expect((user as { remoteWallets: unknown[] }).remoteWallets).toEqual([])
    errSpy.mockRestore()
  })
})
