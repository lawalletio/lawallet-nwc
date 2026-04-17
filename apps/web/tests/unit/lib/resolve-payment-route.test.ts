import { describe, it, expect } from 'vitest'
import {
  parseLightningAddress,
  resolvePaymentRoute,
} from '@/lib/wallet/resolve-payment-route'

describe('resolvePaymentRoute', () => {
  const baseInput = {
    redirect: null,
    nwcConnection: null,
    primaryNwcConnection: null,
    userNwc: null,
  }

  it('returns idle for IDLE mode regardless of other fields', () => {
    expect(
      resolvePaymentRoute({
        ...baseInput,
        mode: 'IDLE',
        nwcConnection: { connectionString: 'nostr+walletconnect://x' },
        userNwc: 'nostr+walletconnect://y',
      }),
    ).toEqual({ kind: 'idle' })
  })

  it('returns alias when ALIAS has a non-empty redirect, trimmed', () => {
    expect(
      resolvePaymentRoute({ ...baseInput, mode: 'ALIAS', redirect: '  bob@other.com  ' }),
    ).toEqual({ kind: 'alias', redirect: 'bob@other.com' })
  })

  it('returns unconfigured when ALIAS has no redirect or only whitespace', () => {
    expect(resolvePaymentRoute({ ...baseInput, mode: 'ALIAS', redirect: null })).toEqual({
      kind: 'unconfigured',
    })
    expect(resolvePaymentRoute({ ...baseInput, mode: 'ALIAS', redirect: '   ' })).toEqual({
      kind: 'unconfigured',
    })
  })

  it('returns nwc using the linked connection for CUSTOM_NWC', () => {
    expect(
      resolvePaymentRoute({
        ...baseInput,
        mode: 'CUSTOM_NWC',
        nwcConnection: { connectionString: 'nostr+walletconnect://custom' },
        // Should be ignored — CUSTOM_NWC never falls back to the primary.
        primaryNwcConnection: { connectionString: 'nostr+walletconnect://primary' },
      }),
    ).toEqual({ kind: 'nwc', connectionString: 'nostr+walletconnect://custom' })
  })

  it('returns unconfigured for CUSTOM_NWC without a linked connection (no fallback)', () => {
    expect(
      resolvePaymentRoute({
        ...baseInput,
        mode: 'CUSTOM_NWC',
        primaryNwcConnection: { connectionString: 'nostr+walletconnect://primary' },
        userNwc: 'nostr+walletconnect://legacy',
      }),
    ).toEqual({ kind: 'unconfigured' })
  })

  it('returns nwc using the user primary connection for DEFAULT_NWC', () => {
    expect(
      resolvePaymentRoute({
        ...baseInput,
        mode: 'DEFAULT_NWC',
        primaryNwcConnection: { connectionString: 'nostr+walletconnect://primary' },
        userNwc: 'nostr+walletconnect://legacy',
      }),
    ).toEqual({ kind: 'nwc', connectionString: 'nostr+walletconnect://primary' })
  })

  it('falls back to legacy User.nwc for DEFAULT_NWC when no primary exists', () => {
    expect(
      resolvePaymentRoute({
        ...baseInput,
        mode: 'DEFAULT_NWC',
        userNwc: 'nostr+walletconnect://legacy',
      }),
    ).toEqual({ kind: 'nwc', connectionString: 'nostr+walletconnect://legacy' })
  })

  it('returns unconfigured for DEFAULT_NWC when neither primary nor legacy is set', () => {
    expect(resolvePaymentRoute({ ...baseInput, mode: 'DEFAULT_NWC' })).toEqual({
      kind: 'unconfigured',
    })
  })
})

describe('parseLightningAddress', () => {
  it('parses well-formed addresses, normalising case', () => {
    expect(parseLightningAddress('Alice@Example.com')).toEqual({
      user: 'alice',
      host: 'example.com',
    })
    expect(parseLightningAddress('a.b+tag@sub.domain.io')).toEqual({
      user: 'a.b+tag',
      host: 'sub.domain.io',
    })
  })

  it('rejects malformed addresses', () => {
    expect(parseLightningAddress('no-at-sign')).toBeNull()
    expect(parseLightningAddress('@example.com')).toBeNull()
    expect(parseLightningAddress('user@')).toBeNull()
    expect(parseLightningAddress('user@nodot')).toBeNull()
    expect(parseLightningAddress('user@host.x')).toBeNull() // TLD too short
    expect(parseLightningAddress('bad space@example.com')).toBeNull()
  })
})
