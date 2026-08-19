import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ logLevel: 'silent' })
}))

const getInfo = vi.fn()
vi.mock('@/lib/wallet/drivers/nwc-client-cache', () => ({
  getServerNwcClient: vi.fn(async () => ({ getInfo }))
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    remoteWallet: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}))

import { prisma } from '@/lib/prisma'
import {
  nwcWalletCanSend,
  probeNwcCanSend,
  resolveNwcModeForCreate
} from '@/lib/wallet/nwc-send-capability'

const CONNECTION = 'nostr+walletconnect://abc'
const SENDABLE = { methods: ['get_info', 'make_invoice', 'pay_invoice'] }
const RECEIVE_ONLY = { methods: ['get_info', 'make_invoice'] }

beforeEach(() => {
  getInfo.mockReset()
  vi.mocked(prisma.remoteWallet.findUnique).mockReset()
  vi.mocked(prisma.remoteWallet.update).mockReset()
  vi.mocked(prisma.remoteWallet.findUnique).mockResolvedValue({
    config: { connectionString: 'lwrw1:sealed', mode: 'RECEIVE' }
  } as never)
  vi.mocked(prisma.remoteWallet.update).mockResolvedValue({} as never)
})

describe('probeNwcCanSend', () => {
  it('returns null when the wallet cannot be reached', async () => {
    getInfo.mockRejectedValue(new Error('relay down'))
    expect(await probeNwcCanSend(CONNECTION)).toBeNull()
  })

  it('reports whether pay_invoice is granted', async () => {
    getInfo.mockResolvedValue(SENDABLE)
    expect(await probeNwcCanSend(CONNECTION)).toBe(true)

    getInfo.mockResolvedValue(RECEIVE_ONLY)
    expect(await probeNwcCanSend(CONNECTION)).toBe(false)
  })
})

describe('nwcWalletCanSend', () => {
  it('trusts a stored SEND_RECEIVE without touching the relay', async () => {
    const canSend = await nwcWalletCanSend({
      walletId: 'w1',
      config: { connectionString: CONNECTION, mode: 'SEND_RECEIVE' }
    })

    expect(canSend).toBe(true)
    expect(getInfo).not.toHaveBeenCalled()
  })

  it('repairs a stale RECEIVE when the wallet does grant pay_invoice', async () => {
    getInfo.mockResolvedValue(SENDABLE)

    const canSend = await nwcWalletCanSend({
      walletId: 'stale-wallet',
      config: { connectionString: CONNECTION, mode: 'RECEIVE' }
    })

    expect(canSend).toBe(true)
    // The sealed connection string is carried over untouched — only `mode`
    // changes, so the repair never needs (or risks re-sealing) the plaintext.
    expect(prisma.remoteWallet.update).toHaveBeenCalledWith({
      where: { id: 'stale-wallet' },
      data: {
        config: { connectionString: 'lwrw1:sealed', mode: 'SEND_RECEIVE' }
      }
    })
  })

  it('still refuses a genuinely receive-only wallet, and caches that', async () => {
    getInfo.mockResolvedValue(RECEIVE_ONLY)

    const first = await nwcWalletCanSend({
      walletId: 'receive-only',
      config: { connectionString: CONNECTION, mode: 'RECEIVE' }
    })
    const second = await nwcWalletCanSend({
      walletId: 'receive-only',
      config: { connectionString: CONNECTION, mode: 'RECEIVE' }
    })

    expect(first).toBe(false)
    expect(second).toBe(false)
    expect(prisma.remoteWallet.update).not.toHaveBeenCalled()
    // Second call served from the negative cache — no extra relay round-trip.
    expect(getInfo).toHaveBeenCalledTimes(1)
  })

  it('refuses when the wallet is unreachable rather than assuming it can pay', async () => {
    getInfo.mockRejectedValue(new Error('relay down'))

    const canSend = await nwcWalletCanSend({
      walletId: 'unreachable',
      config: { connectionString: CONNECTION, mode: 'RECEIVE' }
    })

    expect(canSend).toBe(false)
    expect(prisma.remoteWallet.update).not.toHaveBeenCalled()
  })
})

describe('resolveNwcModeForCreate', () => {
  it('upgrades a client-claimed RECEIVE the wallet contradicts', async () => {
    getInfo.mockResolvedValue(SENDABLE)
    expect(await resolveNwcModeForCreate(CONNECTION, 'RECEIVE')).toBe(
      'SEND_RECEIVE'
    )
  })

  it('downgrades a client-claimed SEND_RECEIVE the wallet does not grant', async () => {
    getInfo.mockResolvedValue(RECEIVE_ONLY)
    expect(await resolveNwcModeForCreate(CONNECTION, 'SEND_RECEIVE')).toBe(
      'RECEIVE'
    )
  })

  it('keeps the claimed mode when the wallet is unreachable', async () => {
    getInfo.mockRejectedValue(new Error('relay down'))
    expect(await resolveNwcModeForCreate(CONNECTION, 'SEND_RECEIVE')).toBe(
      'SEND_RECEIVE'
    )
  })
})
