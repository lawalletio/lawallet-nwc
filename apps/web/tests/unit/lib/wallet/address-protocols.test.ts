import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxy/config', () => ({ getActiveProxyConfig: vi.fn() }))
vi.mock('@/lib/listener-config', () => ({ getListenerConfig: vi.fn() }))
vi.mock('@/lib/nostr/zap-receipts', () => ({
  getZapReceiptCapability: vi.fn()
}))

import { resolveAddressProtocols } from '@/lib/wallet/address-protocols'
import { getActiveProxyConfig } from '@/lib/proxy/config'
import { getListenerConfig } from '@/lib/listener-config'
import { getZapReceiptCapability } from '@/lib/nostr/zap-receipts'

const user = {
  id: 'user-1',
  pubkey: 'ab'.repeat(32),
  nostrIdentities: [{ pubkey: 'ab'.repeat(32) }]
}

const base = { redirect: null, aliasProtocols: null, routable: true, user }

beforeEach(() => {
  vi.mocked(getZapReceiptCapability).mockResolvedValue({
    lud21: true,
    nip57: true,
    reason: null
  } as never)
  vi.mocked(getActiveProxyConfig).mockResolvedValue(null as never)
  vi.mocked(getListenerConfig).mockResolvedValue({ enabled: false } as never)
})

describe('resolveAddressProtocols', () => {
  it('reports nothing payable for a disabled address', async () => {
    const result = await resolveAddressProtocols({ ...base, mode: 'IDLE' })
    expect(result.protocols).toMatchObject({
      lud16: false,
      lud21: false,
      nip57: false,
      lud12: false
    })
    // NIP-05 is this domain publishing the name, not a payment route.
    expect(result.protocols.nip05).toBe(true)
  })

  it('serves a bound wallet address from this instance', async () => {
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'CUSTOM_NWC'
    })
    expect(result.source).toBe('wallet')
    expect(result.protocols).toEqual({
      lud16: true,
      nip05: true,
      lud21: true,
      nip57: true,
      lud12: true
    })
  })

  it('offers nothing when the bound wallet is not active', async () => {
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'CUSTOM_NWC',
      routable: false
    })
    expect(result.source).toBe('unavailable')
    expect(result.protocols.lud16).toBe(false)
    expect(result.protocols.nip57).toBe(false)
  })

  // An alias hands the payer the target's payRequest, so the answer is the
  // target's — and is unknown until the redirect has been probed.
  it('reports an unprobed alias as unknown rather than unsupported', async () => {
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'ALIAS',
      redirect: 'bob@strike.me'
    })
    expect(result.source).toBe('alias')
    expect(result.provider).toBe('bob@strike.me')
    expect(result.protocols.lud16).toBeNull()
    expect(result.protocols.nip57).toBeNull()
    expect(result.reason).toMatch(/Save the redirect again/)
  })

  it('reports a probed alias from what its target answered', async () => {
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'ALIAS',
      redirect: 'bob@strike.me',
      aliasProtocols: {
        lud16: true,
        lud21: false,
        nip57: true,
        lud12: false,
        checkedAt: '2026-08-06T00:00:00.000Z'
      }
    })
    expect(result.protocols).toEqual({
      lud16: true,
      nip05: true,
      lud21: false,
      nip57: true,
      lud12: false
    })
  })

  it('ignores a stored blob that is not a probe result', async () => {
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'ALIAS',
      redirect: 'bob@strike.me',
      aliasProtocols: { lud16: true }
    })
    expect(result.protocols.lud16).toBeNull()
  })

  it('credits the proxy when it is fully configured', async () => {
    vi.mocked(getActiveProxyConfig).mockResolvedValue({
      receiptPrivateKey: 'k',
      row: { receiptPubkey: 'p' }
    } as never)
    vi.mocked(getListenerConfig).mockResolvedValue({ enabled: true } as never)
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'PROXY_ALIAS',
      redirect: 'bob@strike.me'
    })
    expect(result.source).toBe('proxy')
    expect(result.protocols.lud21).toBe(true)
    expect(result.protocols.nip57).toBe(true)
  })

  // A capability read must never break the route that carries it.
  it('survives an account with no usable pubkey', async () => {
    const result = await resolveAddressProtocols({
      ...base,
      mode: 'CUSTOM_NWC',
      user: null
    })
    expect(result.protocols.nip05).toBe(false)
    expect(result.protocols.lud16).toBe(true)
  })
})
