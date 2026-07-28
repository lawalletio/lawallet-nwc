import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createRemoteWalletFixture,
  createUserFixture
} from '@/tests/helpers/fixtures'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    nwcVault: {
      secret: 'test-reveal-nwc-vault-secret-0123456789abcdef',
      previousSecrets: [],
      enabled: true
    }
  }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))
vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

import { GET as connectionStringHandler } from '@/app/api/remote-wallets/[id]/connection-string/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { encryptRemoteWalletEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

const PUBKEY = 'a'.repeat(64)
const NWC_URI =
  'nostr+walletconnect://' +
  'b'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'c'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: 'USER' as never,
    method: 'jwt'
  })
})

describe('GET /api/remote-wallets/[id]/connection-string', () => {
  it('decrypts an owned RemoteWallet connection for its authorized client', async () => {
    const user = createUserFixture({ id: 'user-1', pubkey: PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      createRemoteWalletFixture({
        id: 'wallet-1',
        userId: user.id,
        config: {
          connectionString: encryptRemoteWalletEnvelope(
            NWC_URI,
            'wallet-1',
            'test-reveal-nwc-vault-secret-0123456789abcdef'
          ),
          mode: 'SEND_RECEIVE'
        }
      }) as never
    )

    const response = await connectionStringHandler(
      createNextRequest('/api/remote-wallets/wallet-1/connection-string'),
      createParamsPromise({ id: 'wallet-1' })
    )
    expect(await assertResponse(response, 200)).toEqual({
      connectionString: NWC_URI
    })
  })

  it('does not reveal another user’s connection', async () => {
    const user = createUserFixture({ id: 'user-1', pubkey: PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      createRemoteWalletFixture({
        id: 'wallet-1',
        userId: 'user-2'
      }) as never
    )

    const response = await connectionStringHandler(
      createNextRequest('/api/remote-wallets/wallet-1/connection-string'),
      createParamsPromise({ id: 'wallet-1' })
    )
    expect(response.status).toBe(404)
  })
})
