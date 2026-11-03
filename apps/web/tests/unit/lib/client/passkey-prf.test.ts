vi.mock('@nostr-wot/identity/vault', { spy: true })
import * as identitySdk from '@nostr-wot/identity/vault'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  PRF_SALT_HEX,
  prfSaltBytes,
  derivePrfNsecHex,
  getPrfAssertion,
  passkeyAssertion
} from '@/lib/client/passkey-prf'
import { getPublicKeyFromPrivate } from '@/lib/nostr'

describe('passkey PRF derivation', () => {
  it('shares the caller-owned PRF buffer instead of leaving an extra secret copy', async () => {
    const derive = vi.spyOn(identitySdk, 'deriveNostrKey')
    try {
      const input = new Uint8Array(32).fill(7)
      await derivePrfNsecHex(input)
      expect(derive.mock.calls[0][0]).toBe(input)
      expect(
        derive.mock.results[0].value.secret.every((b: number) => b === 0)
      ).toBe(true)
    } finally {
      derive.mockRestore()
    }
  })

  it('pins the consensus-critical salt (sha256 of lawallet-nsec-prf-v1)', async () => {
    expect(PRF_SALT_HEX).toBe(
      '8ee22949c1045c627e14236f1d06cf730b46b4cf309cbf4ede25a446cf33ad8d'
    )
    // Recompute to prove the constant matches its documented derivation.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('lawallet-nsec-prf-v1')
    )
    const hex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    expect(hex).toBe(PRF_SALT_HEX)
    expect(prfSaltBytes()).toHaveLength(32)
  })

  it('derives deterministically — fixed vector frozen forever', async () => {
    // ⚠️ FROZEN VECTOR: if this assertion ever fails, the derivation changed
    // and every existing passkey-derived identity would be orphaned. Revert
    // the change to passkey-prf.ts instead of updating this vector.
    const prfOutput = new Uint8Array(32).fill(7)
    const first = await derivePrfNsecHex(prfOutput)
    const second = await derivePrfNsecHex(prfOutput)
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(
      'a1e1ac8dd866cabdf743a4cdedbf53c680444094a25c0ffc4e558ec5a78831c1'
    )
  })

  it('different PRF outputs derive different keys', async () => {
    const a = await derivePrfNsecHex(new Uint8Array(32).fill(1))
    const b = await derivePrfNsecHex(new Uint8Array(32).fill(2))
    expect(a).not.toBe(b)
  })

  it('derived keys are valid secp256k1 scalars (pubkey derivable)', async () => {
    for (const fill of [1, 7, 200, 255]) {
      const hex = await derivePrfNsecHex(new Uint8Array(32).fill(fill))
      expect(getPublicKeyFromPrivate(hex)).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('getPrfAssertion', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubAssertion(userHandle: string | null, withPrf = true) {
    const get = vi.fn().mockResolvedValue({
      rawId: new Uint8Array([1, 2, 3]).buffer,
      response: {
        userHandle: userHandle && new Uint8Array(Buffer.from(userHandle, 'hex'))
      },
      getClientExtensionResults: () =>
        withPrf ? { prf: { results: { first: new Uint8Array(32) } } } : {}
    })
    vi.stubGlobal('navigator', { credentials: { get } })
  }

  it.each([
    ['tagged 0x02', '4e504b010102ffeeddccbbaa99887766554433221100'],
    ['legacy UUID', Buffer.from(crypto.randomUUID()).toString('hex')],
    ['missing', null]
  ])('accepts a %s handle', async (_label, handle) => {
    stubAssertion(handle)
    expect((await getPrfAssertion()).credentialId).toBe('AQID')
  })

  it("refuses another app's passkey before reading the PRF result", async () => {
    stubAssertion('79'.repeat(32), false)
    await expect(getPrfAssertion()).rejects.toMatchObject({
      name: 'ForeignPasskeyError'
    })
  })
})

it('rejects and clears output when PRF is explicitly disabled', async () => {
  const output = new Uint8Array(32).fill(7)
  vi.stubGlobal('navigator', {
    credentials: {
      get: vi.fn().mockResolvedValue({
        rawId: new Uint8Array([1]).buffer,
        response: { userHandle: null },
        getClientExtensionResults: () => ({
          prf: { enabled: false, results: { first: output.buffer } }
        })
      })
    }
  })
  try {
    await expect(passkeyAssertion({})).rejects.toMatchObject({
      name: 'PrfUnsupportedError'
    })
    expect(output.every(byte => byte === 0)).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})
