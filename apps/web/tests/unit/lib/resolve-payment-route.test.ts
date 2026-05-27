import { describe, it, expect } from 'vitest'
import {
  parseLightningAddress,
  resolveWalletRoute,
  resolveCardWallet,
  type ResolveWalletRouteInput,
  type ResolveCardWalletInput,
} from '@/lib/wallet/resolve-payment-route'

const activeWallet = {
  type: 'NWC' as const,
  config: { connectionString: 'nostr+walletconnect://bound', mode: 'SEND_RECEIVE' },
  status: 'ACTIVE' as const,
}

describe('resolveWalletRoute', () => {
  const base: ResolveWalletRouteInput = {
    mode: 'IDLE',
    redirect: null,
    remoteWallet: null,
    defaultRemoteWallet: null,
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
      ).toEqual({ kind: 'wallet', type: 'NWC', config: activeWallet.config })
    })

    it('returns unconfigured when the bound wallet is DISABLED (no silent reroute)', () => {
      expect(
        resolveWalletRoute({
          ...base,
          mode: 'CUSTOM_NWC',
          remoteWallet: { ...activeWallet, status: 'DISABLED' },
        }),
      ).toEqual({ kind: 'unconfigured' })
    })

    it('returns unconfigured when nothing is bound', () => {
      expect(resolveWalletRoute({ ...base, mode: 'CUSTOM_NWC' })).toEqual({
        kind: 'unconfigured',
      })
    })
  })

  describe('DEFAULT_NWC', () => {
    it('routes through the default RemoteWallet when ACTIVE', () => {
      expect(
        resolveWalletRoute({ ...base, mode: 'DEFAULT_NWC', defaultRemoteWallet: activeWallet }),
      ).toEqual({ kind: 'wallet', type: 'NWC', config: activeWallet.config })
    })

    it('returns unconfigured when the default is DISABLED', () => {
      expect(
        resolveWalletRoute({
          ...base,
          mode: 'DEFAULT_NWC',
          defaultRemoteWallet: { ...activeWallet, status: 'DISABLED' },
        }),
      ).toEqual({ kind: 'unconfigured' })
    })

    it('returns unconfigured when there is no default', () => {
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
  }

  it('routes through the card-bound RemoteWallet when ACTIVE', () => {
    expect(resolveCardWallet({ ...base, remoteWallet: activeWallet })).toEqual({
      kind: 'wallet',
      type: 'NWC',
      config: activeWallet.config,
    })
  })

  it('returns unconfigured when the bound wallet is DISABLED (never reroutes a spend)', () => {
    expect(
      resolveCardWallet({
        ...base,
        remoteWallet: { ...activeWallet, status: 'DISABLED' },
        defaultRemoteWallet: activeWallet, // present but must NOT be used
      }),
    ).toEqual({ kind: 'unconfigured' })
  })

  it('falls back to the default RemoteWallet when the card has no binding', () => {
    expect(resolveCardWallet({ ...base, defaultRemoteWallet: activeWallet })).toEqual({
      kind: 'wallet',
      type: 'NWC',
      config: activeWallet.config,
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

  it('returns null for malformed input', () => {
    expect(parseLightningAddress('noatsign')).toBeNull()
    expect(parseLightningAddress('@host.com')).toBeNull()
    expect(parseLightningAddress('user@')).toBeNull()
    expect(parseLightningAddress('user@nodot')).toBeNull()
  })
})
