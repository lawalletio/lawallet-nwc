import { describe, it, expect } from 'vitest'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'

describe('resolveUserNwc', () => {
  const EFFECTIVE = 'nostr+walletconnect://effective'
  const DEFAULT = 'nostr+walletconnect://default'

  it('prefers the primary remote wallet when both wallet sources are present', () => {
    expect(
      resolveUserNwc({ effectiveNwcString: EFFECTIVE, nwcString: DEFAULT }),
    ).toBe(DEFAULT)
  })

  it('uses the primary remote wallet when the address is not routable', () => {
    expect(
      resolveUserNwc({ effectiveNwcString: null, nwcString: DEFAULT }),
    ).toBe(DEFAULT)
  })

  it('returns null when neither wallet is available', () => {
    // `nwcString` is `''` (not null) when the user has no default wallet.
    expect(resolveUserNwc({ effectiveNwcString: null, nwcString: '' })).toBeNull()
  })

  it('falls back to the address-routed wallet when no primary remote wallet is present', () => {
    expect(
      resolveUserNwc({ effectiveNwcString: EFFECTIVE, nwcString: '' }),
    ).toBe(EFFECTIVE)
  })

  it('treats an empty effectiveNwcString as absent', () => {
    expect(
      resolveUserNwc({ effectiveNwcString: '', nwcString: '' }),
    ).toBeNull()
  })

  it('returns null when `me` has not loaded yet', () => {
    expect(resolveUserNwc(null)).toBeNull()
    expect(resolveUserNwc(undefined)).toBeNull()
  })
})
