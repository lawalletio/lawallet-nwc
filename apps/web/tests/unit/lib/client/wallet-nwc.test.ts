import { describe, it, expect } from 'vitest'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'

describe('resolveUserNwc', () => {
  const EFFECTIVE = 'nostr+walletconnect://effective'
  const DEFAULT = 'nostr+walletconnect://default'

  it('prefers the address-routed effectiveNwcString when present', () => {
    expect(
      resolveUserNwc({ effectiveNwcString: EFFECTIVE, nwcString: DEFAULT }),
    ).toBe(EFFECTIVE)
  })

  it('falls back to the default wallet when the address is not routable', () => {
    // The reported bug: IDLE / ALIAS / unbound CUSTOM_NWC leave
    // effectiveNwcString null, but the user still has a connected wallet.
    expect(
      resolveUserNwc({ effectiveNwcString: null, nwcString: DEFAULT }),
    ).toBe(DEFAULT)
  })

  it('returns null when neither wallet is available', () => {
    // `nwcString` is `''` (not null) when the user has no default wallet.
    expect(resolveUserNwc({ effectiveNwcString: null, nwcString: '' })).toBeNull()
  })

  it('treats an empty effectiveNwcString as absent and falls through', () => {
    expect(
      resolveUserNwc({ effectiveNwcString: '', nwcString: DEFAULT }),
    ).toBe(DEFAULT)
  })

  it('returns null when `me` has not loaded yet', () => {
    expect(resolveUserNwc(null)).toBeNull()
    expect(resolveUserNwc(undefined)).toBeNull()
  })
})
