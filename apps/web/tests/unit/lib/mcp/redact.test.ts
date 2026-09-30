import { describe, it, expect } from 'vitest'
import { REDACTED, redactSecrets } from '@/lib/mcp/redact'

const NWC = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`
const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'

describe('redactSecrets — by value', () => {
  it('replaces NWC URIs in both schemes, whatever the key', () => {
    expect(redactSecrets({ note: NWC })).toEqual({
      note: '[redacted NWC connection string]'
    })
    expect(
      redactSecrets({ uri: `nostrwalletconnect://${'a'.repeat(64)}?relay=x` })
    ).toEqual({ uri: '[redacted NWC connection string]' })
    expect(redactSecrets(`Invalid wallet ${NWC.toUpperCase()}`)).toBe(
      '[redacted NWC connection string]'
    )
  })

  it('replaces nsec keys embedded anywhere in a string', () => {
    expect(redactSecrets(`imported ${NSEC} ok`)).toBe('[redacted nsec key]')
    expect(redactSecrets({ list: [[NSEC]] })).toEqual({
      list: [['[redacted nsec key]']]
    })
  })

  it('leaves ordinary values alone', () => {
    const value = {
      username: 'alice',
      pubkey: 'a'.repeat(64),
      npub: 'npub1xyz',
      amountSats: 21,
      enabled: true,
      nothing: null,
      when: new Date('2026-01-01T00:00:00Z'),
      big: BigInt(5)
    }
    expect(redactSecrets(value)).toEqual(value)
  })
})

describe('redactSecrets — by key', () => {
  it('redacts values under secret-naming keys, nested and in arrays', () => {
    expect(
      redactSecrets({
        wallets: [
          { id: 'w1', config: { connectionString: 'opaque-without-scheme' } },
          { id: 'w2', private_key: 'f'.repeat(64) }
        ],
        listener_auth_secret: 'hmac-secret',
        external_device_key: 'pairing-key',
        nwcUri: 'x',
        ACCESS_TOKEN: 'lwat_x'
      })
    ).toEqual({
      wallets: [
        { id: 'w1', config: { connectionString: REDACTED } },
        { id: 'w2', private_key: REDACTED }
      ],
      listener_auth_secret: REDACTED,
      external_device_key: REDACTED,
      nwcUri: REDACTED,
      ACCESS_TOKEN: REDACTED
    })
  })

  it('redacts whole objects under a secret key', () => {
    expect(redactSecrets({ secrets: { a: 1 }, secretList: ['x'] })).toEqual({
      secrets: REDACTED,
      secretList: REDACTED
    })
  })

  it('keeps flags that describe a secret without carrying it', () => {
    const flags = {
      hasReceiptNsec: true,
      listener_secret_configured: 'false',
      nwcString: '',
      connectionString: null,
      secretCount: 3
    }
    expect(redactSecrets(flags)).toEqual(flags)
  })
})

describe('redactSecrets — realistic REST payloads', () => {
  it('GET /api/users/me', () => {
    expect(
      redactSecrets({
        userId: 'u1',
        lightningAddress: 'alice@example.com',
        nwcString: NWC,
        nwcUpdatedAt: '2026-01-01T00:00:00.000Z',
        effectiveNwcString: NWC,
        primaryAddressMode: 'CUSTOM_NWC',
        primaryUsername: 'alice',
        primaryRedirect: null,
        currencyPrefs: null
      })
    ).toEqual({
      userId: 'u1',
      lightningAddress: 'alice@example.com',
      nwcString: REDACTED,
      nwcUpdatedAt: '2026-01-01T00:00:00.000Z',
      effectiveNwcString: REDACTED,
      primaryAddressMode: 'CUSTOM_NWC',
      primaryUsername: 'alice',
      primaryRedirect: null,
      currencyPrefs: null
    })
  })

  it('GET /api/wallet/addresses/{username}', () => {
    const result = redactSecrets({
      address: { username: 'alice', mode: 'CUSTOM_NWC' },
      wallets: [{ id: 'w1', name: 'Main', type: 'NWC', isDefault: true }],
      effectiveConnectionString: NWC,
      isOwner: true
    }) as Record<string, unknown>
    expect(result.effectiveConnectionString).toBe(REDACTED)
    expect(result.wallets).toEqual([
      { id: 'w1', name: 'Main', type: 'NWC', isDefault: true }
    ])
  })

  it('POST /api/cards returns card keys and the claim code', () => {
    expect(
      redactSecrets({
        id: 'card1',
        otc: 'one-time-code',
        ntag424: {
          cid: '04AABBCC',
          k0: '0'.repeat(32),
          k1: '1'.repeat(32),
          k2: '2'.repeat(32),
          k3: '3'.repeat(32),
          k4: '4'.repeat(32),
          ctr: 0
        }
      })
    ).toEqual({
      id: 'card1',
      otc: REDACTED,
      ntag424: {
        cid: '04AABBCC',
        k0: REDACTED,
        k1: REDACTED,
        k2: REDACTED,
        k3: REDACTED,
        k4: REDACTED,
        ctr: 0
      }
    })
  })

  it('GET /api/settings keeps flags but hides the device pairing key', () => {
    expect(
      redactSecrets({
        domain: 'example.com',
        external_device_key: 'k',
        listener_secret_configured: 'true',
        listener_enabled: 'true'
      })
    ).toEqual({
      domain: 'example.com',
      external_device_key: REDACTED,
      listener_secret_configured: 'true',
      listener_enabled: 'true'
    })
  })

  it('vouchers hide the coupon code, bare and inside the signed event', () => {
    expect(
      redactSecrets([
        {
          id: 'v1',
          name: 'Coffee',
          nonce: 'coupon-code',
          voucherEvent: { kind: 1, tags: [['nonce', 'coupon-code']] },
          status: 'MINTED'
        }
      ])
    ).toEqual([
      {
        id: 'v1',
        name: 'Coffee',
        nonce: REDACTED,
        voucherEvent: REDACTED,
        status: 'MINTED'
      }
    ])
  })
})
