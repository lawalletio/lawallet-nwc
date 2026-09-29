import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ logLevel: 'silent', maintenance: { enabled: false } })
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { card: { findUnique: vi.fn() } }
}))

import {
  CARD_LNURLP_MAX_SENDABLE_MSATS,
  CARD_LNURLP_MIN_SENDABLE_MSATS,
  cardLnurlPayCallbackUrl,
  cardLnurlPayHttpsUrl,
  cardScanPayLink,
  decideCardReceive,
  lud17PayLink
} from '@/lib/card-payments/lnurl-pay'
import type { CardWalletRoute } from '@/lib/wallet/resolve-payment-route'

const walletRoute: CardWalletRoute = {
  kind: 'wallet',
  walletId: 'wallet-1',
  type: 'NWC',
  config: { mode: 'RECEIVE' }
}

const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=' +
  encodeURIComponent('wss://relay.example') +
  '&secret=' +
  'b'.repeat(64)

const activeWallet = {
  id: 'wallet-1',
  type: 'NWC' as const,
  config: { connectionString: NWC_URI, mode: 'RECEIVE' as const },
  status: 'ACTIVE' as const
}

describe('lud17PayLink', () => {
  it('rewrites https to a raw lnurlp URL and keeps host, port, and path', () => {
    expect(lud17PayLink('https://app.example.com/api/cards/abc/lnurlp')).toBe(
      'lnurlp://app.example.com/api/cards/abc/lnurlp'
    )
    expect(lud17PayLink('http://localhost:3000/api/cards/abc/lnurlp')).toBe(
      'lnurlp://localhost:3000/api/cards/abc/lnurlp'
    )
  })
})

describe('decideCardReceive', () => {
  it('accepts a paired card bound to an active wallet', () => {
    const decision = decideCardReceive({
      blockedAt: null,
      disabledAt: null,
      remoteWallet: activeWallet,
      user: { lightningAddresses: [] }
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.route.walletId).toBe('wallet-1')
  })

  it('falls back to the owner primary wallet without pointing at LUD-16', () => {
    const decision = decideCardReceive({
      blockedAt: null,
      disabledAt: null,
      remoteWallet: null,
      user: {
        lightningAddresses: [
          {
            mode: 'CUSTOM_NWC',
            remoteWalletId: 'primary-1',
            remoteWallet: { ...activeWallet, id: 'primary-1' }
          }
        ]
      }
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.route.walletId).toBe('primary-1')
    expect(cardLnurlPayHttpsUrl('https://app.example.com', 'card-1')).toBe(
      'https://app.example.com/api/cards/card-1/lnurlp'
    )
    expect(
      cardLnurlPayHttpsUrl('https://app.example.com', 'card-1')
    ).not.toContain('lud16')
  })

  it('refuses unpaired, blocked, disabled, and wallet-less cards', () => {
    const base = {
      blockedAt: null,
      disabledAt: null,
      remoteWallet: activeWallet,
      user: { lightningAddresses: [] }
    }
    expect(decideCardReceive({ ...base, user: null }).ok).toBe(false)
    expect(decideCardReceive({ ...base, blockedAt: new Date() }).ok).toBe(false)
    expect(decideCardReceive({ ...base, disabledAt: new Date() }).ok).toBe(
      false
    )
    expect(
      decideCardReceive({
        ...base,
        remoteWallet: null,
        user: { lightningAddresses: [] }
      }).ok
    ).toBe(false)
  })

  it('prefers the card binding over the primary wallet', () => {
    const decision = decideCardReceive({
      blockedAt: null,
      disabledAt: null,
      remoteWallet: activeWallet,
      user: {
        lightningAddresses: [
          {
            mode: 'CUSTOM_NWC',
            remoteWalletId: 'primary-1',
            remoteWallet: { ...activeWallet, id: 'primary-1' }
          }
        ]
      }
    })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.route.walletId).toBe('wallet-1')
  })
})

describe('cardScanPayLink', () => {
  const card = {
    blockedAt: null,
    disabledAt: null,
    remoteWallet: activeWallet,
    user: { lightningAddresses: [] }
  }

  it('returns a raw lnurlp URL when the resolved route can receive', () => {
    expect(
      cardScanPayLink('https://app.example.com', 'card-1', card, walletRoute)
    ).toBe('lnurlp://app.example.com/api/cards/card-1/lnurlp')
    expect(cardLnurlPayCallbackUrl('https://app.example.com', 'card-1')).toBe(
      'https://app.example.com/api/cards/card-1/lnurlp/cb'
    )
  })

  it('omits the link when the route has no wallet', () => {
    expect(
      cardScanPayLink('https://app.example.com', 'card-1', card, {
        kind: 'unconfigured'
      })
    ).toBeUndefined()
  })

  it('uses the same millisatoshi bounds as a lightning-address payRequest', () => {
    expect(CARD_LNURLP_MIN_SENDABLE_MSATS).toBe(1000)
    expect(CARD_LNURLP_MAX_SENDABLE_MSATS).toBe(1_000_000_000)
  })
})
