import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { NotFoundError } from '@/types/server/errors'

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { ADDRESS_UPDATED: 'address.updated' },
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

vi.mock('@/lib/lnurl-probe', () => ({
  probeLightningAddressCapabilities: vi.fn()
}))

vi.mock('@/lib/proxy/config', () => ({ getActiveProxyConfig: vi.fn() }))
vi.mock('@/lib/listener-config', () => ({ getListenerConfig: vi.fn() }))
vi.mock('@/lib/nostr/zap-receipts', () => ({
  getZapReceiptCapability: vi.fn()
}))

import { verifyAddressProtocols } from '@/lib/wallet/verify-address-protocols'
import { probeLightningAddressCapabilities } from '@/lib/lnurl-probe'
import { eventBus } from '@/lib/events/event-bus'
import { logActivity } from '@/lib/activity-log'
import { getZapReceiptCapability } from '@/lib/nostr/zap-receipts'
import { Prisma } from '@/lib/generated/prisma'

const user = {
  id: 'user-1',
  pubkey: 'ab'.repeat(32),
  nostrIdentities: [{ pubkey: 'ab'.repeat(32) }]
}

function makeAddress(overrides: Record<string, unknown> = {}) {
  return {
    username: 'misscons',
    mode: 'ALIAS',
    redirect: 'olivepanther6@primal.net',
    aliasProtocols: null,
    remoteWallet: null,
    user,
    ...overrides
  }
}

const probeResult = {
  address: 'olivepanther6@primal.net',
  canSave: true,
  checks: {
    lud16: { ok: true, message: 'ok' },
    lud21: { ok: false, message: 'no verify' },
    nip57: { ok: true, message: 'zaps' },
    lud12: { ok: false, message: 'no comments' }
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getZapReceiptCapability).mockResolvedValue({
    lud21: true,
    nip57: true,
    reason: null
  } as never)
})

describe('verifyAddressProtocols', () => {
  it('probes an alias target and persists the result', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress() as never
    )
    vi.mocked(prismaMock.lightningAddress.update).mockResolvedValue({} as never)
    vi.mocked(probeLightningAddressCapabilities).mockResolvedValue(
      probeResult as never
    )

    const result = await verifyAddressProtocols('misscons')

    expect(probeLightningAddressCapabilities).toHaveBeenCalledWith(
      'olivepanther6@primal.net'
    )
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'misscons' },
      data: {
        aliasProtocols: {
          lud16: true,
          lud21: false,
          nip57: true,
          lud12: false,
          checkedAt: expect.any(String)
        }
      }
    })
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'addresses:updated' })
    )
    expect(logActivity.fireAndForget).toHaveBeenCalled()
    expect(result).toMatchObject({
      username: 'misscons',
      probed: true,
      persisted: true,
      error: null
    })
    expect(result.previous.protocols.lud16).toBeNull()
    expect(result.protocols.protocols).toEqual({
      lud16: true,
      nip05: true,
      lud21: false,
      nip57: true,
      lud12: false
    })
  })

  it('stores null and reports the error when the probe throws', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress() as never
    )
    vi.mocked(prismaMock.lightningAddress.update).mockResolvedValue({} as never)
    vi.mocked(probeLightningAddressCapabilities).mockRejectedValue(
      new Error('timeout')
    )

    const result = await verifyAddressProtocols('misscons')

    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'misscons' },
      data: { aliasProtocols: Prisma.JsonNull }
    })
    expect(result.probed).toBe(true)
    expect(result.persisted).toBe(true)
    expect(result.error).toBe('timeout')
    expect(result.protocols.protocols.lud16).toBeNull()
  })

  it('does not probe a bound wallet address', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress({
        mode: 'CUSTOM_NWC',
        redirect: null,
        remoteWallet: { status: 'ACTIVE' }
      }) as never
    )

    const result = await verifyAddressProtocols('misscons')

    expect(probeLightningAddressCapabilities).not.toHaveBeenCalled()
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
    expect(result.probed).toBe(false)
    expect(result.persisted).toBe(false)
    expect(result.protocols.source).toBe('wallet')
    expect(result.protocols.protocols.lud16).toBe(true)
    expect(result.previous).toEqual(result.protocols)
  })

  it('skips probing an alias with no destination', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress({ redirect: null }) as never
    )

    const result = await verifyAddressProtocols('misscons')

    expect(probeLightningAddressCapabilities).not.toHaveBeenCalled()
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
    expect(result.probed).toBe(false)
    expect(result.protocols.protocols.lud16).toBeNull()
  })

  it('throws when the address does not exist', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    await expect(verifyAddressProtocols('ghost')).rejects.toBeInstanceOf(
      NotFoundError
    )
  })
})
