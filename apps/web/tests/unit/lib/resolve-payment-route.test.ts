import { describe, it, expect } from 'vitest'
import {
  parseLightningAddress,
  resolvePaymentRoute,
  resolveWalletRoute,
  resolveCardWallet,
  type ResolveWalletRouteInput,
  type ResolveCardWalletInput,
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

describe('resolveWalletRoute', () => {
  const base: ResolveWalletRouteInput = {
    mode: 'IDLE',
    redirect: null,
    remoteWallet: null,
    defaultRemoteWallet: null,
    nwcConnection: null,
    primaryNwcConnection: null,
    userNwc: null,
  }

  const activeWallet = {
    type: 'NWC' as const,
    config: { connectionString: 'nostr+walletconnect://bound', mode: 'SEND_RECEIVE' },
    status: 'ACTIVE' as const,
  }

  it('returns idle for IDLE', () => {
    expect(resolveWalletRoute({ ...base, mode: 'IDLE' })).toEqual({ kind: 'idle' })
  })

  it('returns alias for ALIAS with a redirect (trimmed)', () => {
    expect(
      resolveWalletRoute({ ...base, mode: 'ALIAS', redirect: '  bob@x.com ' }),
    ).toEqual({ kind: 'alias', redirect: 'bob@x.com' })
  })

  it('returns unconfigured for ALIAS without a redirect', () => {
    expect(resolveWalletRoute({ ...base, mode: 'ALIAS' })).toEqual({ kind: 'unconfigured' })
  })

  describe('CUSTOM_NWC', () => {
    it('routes through the bound RemoteWallet when ACTIVE', () => {
      expect(
        resolveWalletRoute({ ...base, mode: 'CUSTOM_NWC', remoteWallet: activeWallet }),
      ).toEqual({
        kind: 'wallet',
        type: 'NWC',
        config: activeWallet.config,
        source: 'remote-wallet',
      })
    })

    it('returns unconfigured when the bound wallet is DISABLED (no silent reroute)', () => {
      expect(
        resolveWalletRoute({
          ...base,
          mode: 'CUSTOM_NWC',
          remoteWallet: { ...activeWallet, status: 'DISABLED' },
          // legacy fallback present but must NOT be used for an explicit binding
          nwcConnection: { connectionString: 'nostr+walletconnect://legacy' },
        }),
      ).toEqual({ kind: 'unconfigured' })
    })

    it('falls back to the legacy NWCConnection when nothing is bound', () => {
      expect(
        resolveWalletRoute({
          ...base,
          mode: 'CUSTOM_NWC',
          nwcConnection: { connectionString: 'nostr+walletconnect://legacy' },
        }),
      ).toEqual({
        kind: 'wallet',
        type: 'NWC',
        config: { connectionString: 'nostr+walletconnect://legacy', mode: 'RECEIVE' },
        source: 'legacy-nwc',
      })
    })

    it('returns unconfigured when neither bound wallet nor legacy connection exists', () => {
      expect(resolveWalletRoute({ ...base, mode: 'CUSTOM_NWC' })).toEqual({
        kind: 'unconfigured',
      })
    })
  })

  describe('DEFAULT_NWC', () => {
    it('routes through the default RemoteWallet when ACTIVE', () => {
      expect(
        resolveWalletRoute({ ...base, mode: 'DEFAULT_NWC', defaultRemoteWallet: activeWallet }),
      ).toEqual({
        kind: 'wallet',
        type: 'NWC',
        config: activeWallet.config,
        source: 'remote-wallet',
      })
    })

    it('falls back to legacy primary NWCConnection when the default is DISABLED', () => {
      expect(
        resolveWalletRoute({
          ...base,
          mode: 'DEFAULT_NWC',
          defaultRemoteWallet: { ...activeWallet, status: 'DISABLED' },
          primaryNwcConnection: { connectionString: 'nostr+walletconnect://primary' },
        }),
      ).toEqual({
        kind: 'wallet',
        type: 'NWC',
        config: { connectionString: 'nostr+walletconnect://primary', mode: 'RECEIVE' },
        source: 'legacy-nwc',
      })
    })

    it('falls back to legacy User.nwc when no default and no primary', () => {
      expect(
        resolveWalletRoute({
          ...base,
          mode: 'DEFAULT_NWC',
          userNwc: 'nostr+walletconnect://legacy',
        }),
      ).toEqual({
        kind: 'wallet',
        type: 'NWC',
        config: { connectionString: 'nostr+walletconnect://legacy', mode: 'RECEIVE' },
        source: 'legacy-nwc',
      })
    })

    it('prefers the default RemoteWallet over legacy fallbacks', () => {
      const route = resolveWalletRoute({
        ...base,
        mode: 'DEFAULT_NWC',
        defaultRemoteWallet: activeWallet,
        primaryNwcConnection: { connectionString: 'nostr+walletconnect://primary' },
        userNwc: 'nostr+walletconnect://legacy',
      })
      expect(route).toMatchObject({ source: 'remote-wallet', config: activeWallet.config })
    })

    it('returns unconfigured when nothing is set', () => {
      expect(resolveWalletRoute({ ...base, mode: 'DEFAULT_NWC' })).toEqual({
        kind: 'unconfigured',
      })
    })
  })
})

describe('resolveCardWallet', () => {
  const base: ResolveCardWalletInput = {
    remoteWallet: null,
    defaultRemoteWallet: null,
    userNwc: null,
  }
  const activeWallet = {
    type: 'NWC' as const,
    config: { connectionString: 'nostr+walletconnect://card', mode: 'SEND_RECEIVE' },
    status: 'ACTIVE' as const,
  }

  it('routes through the card-bound RemoteWallet when ACTIVE', () => {
    expect(resolveCardWallet({ ...base, remoteWallet: activeWallet })).toEqual({
      kind: 'wallet',
      type: 'NWC',
      config: activeWallet.config,
      source: 'remote-wallet',
    })
  })

  it('returns unconfigured when the bound wallet is DISABLED (never reroutes a spend)', () => {
    expect(
      resolveCardWallet({
        ...base,
        remoteWallet: { ...activeWallet, status: 'DISABLED' },
        defaultRemoteWallet: activeWallet, // present but must NOT be used
        userNwc: 'nostr+walletconnect://legacy',
      }),
    ).toEqual({ kind: 'unconfigured' })
  })

  it('falls back to the default RemoteWallet when the card has no binding', () => {
    expect(resolveCardWallet({ ...base, defaultRemoteWallet: activeWallet })).toMatchObject({
      kind: 'wallet',
      source: 'remote-wallet',
      config: activeWallet.config,
    })
  })

  it('falls back to legacy User.nwc when no bound or default wallet', () => {
    expect(
      resolveCardWallet({ ...base, userNwc: 'nostr+walletconnect://legacy' }),
    ).toEqual({
      kind: 'wallet',
      type: 'NWC',
      config: { connectionString: 'nostr+walletconnect://legacy', mode: 'RECEIVE' },
      source: 'legacy-nwc',
    })
  })

  it('returns unconfigured when nothing is set', () => {
    expect(resolveCardWallet(base)).toEqual({ kind: 'unconfigured' })
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
