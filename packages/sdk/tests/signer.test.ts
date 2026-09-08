import { verifyEvent } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { bytesToHex } from 'nostr-tools/utils'
import { describe, expect, it } from 'vitest'
import { generateSigner, nsecSigner, toPubkey } from '../src'

describe('nsecSigner', () => {
  it('builds a signer from a valid nsec1 string', async () => {
    const { nsec, pubkey } = generateSigner()
    expect(await nsecSigner(nsec).getPublicKey()).toBe(pubkey)
  })

  it('builds a signer from a 64-char hex key, lowercasing uppercase input', async () => {
    const { nsec, pubkey } = generateSigner()
    const hex = bytesToHex(nip19.decode(nsec).data as Uint8Array)
    expect(await nsecSigner(hex).getPublicKey()).toBe(pubkey)
    expect(await nsecSigner(hex.toUpperCase()).getPublicKey()).toBe(pubkey)
  })

  it('trims surrounding whitespace from an nsec and a hex key, decoding the same bytes', async () => {
    const { nsec, pubkey } = generateSigner()
    const hex = bytesToHex(nip19.decode(nsec).data as Uint8Array)

    // Surrounding whitespace — spaces, tabs, newlines — is the common paste
    // artefact; trimming yields byte-for-byte identical secret material.
    expect(await nsecSigner(`  ${nsec}  `).getPublicKey()).toBe(pubkey)
    expect(await nsecSigner(`\n\t${nsec}\r\n `).getPublicKey()).toBe(pubkey)
    expect(await nsecSigner(`  ${hex}  `).getPublicKey()).toBe(pubkey)
    expect(await nsecSigner(`\n${hex}\n`).getPublicKey()).toBe(pubkey)
  })

  it('signs events verifiably with a trimmed key', async () => {
    const { nsec, pubkey } = generateSigner()
    const event = await nsecSigner(`  ${nsec}  `).signEvent({
      kind: 1,
      content: 'hello',
      created_at: 1234567890,
      tags: []
    })
    expect(event.pubkey).toBe(pubkey)
    expect(verifyEvent(event)).toBe(true)
  })

  it('still rejects malformed input after trimming', () => {
    expect(() => nsecSigner('')).toThrow(
      'Expected an nsec1… string or a 64-character hex key'
    )
    expect(() => nsecSigner('   ')).toThrow(
      'Expected an nsec1… string or a 64-character hex key'
    )
    expect(() => nsecSigner('not-a-key')).toThrow(
      'Expected an nsec1… string or a 64-character hex key'
    )
    // An nsec1-looking but invalid bech32 is rejected, not silently accepted.
    expect(() => nsecSigner('nsec1notactuallyvalid')).toThrow()
  })

  it('still rejects a hex key with internal whitespace (trim is external only)', () => {
    // Strictness is preserved on the cleaned value: trim strips surrounding
    // whitespace only, a space inside the hex remains a malformed key.
    const { nsec } = generateSigner()
    const hex = bytesToHex(nip19.decode(nsec).data as Uint8Array)
    expect(() => nsecSigner(`${hex.slice(0, 4)} ${hex.slice(4)}`)).toThrow()
  })
})

describe('nsecSigner / toPubkey input-normalisation parity', () => {
  it('both tolerate the same surrounding-whitespace paste artefact', async () => {
    const { nsec, npub, pubkey } = generateSigner()
    // The sibling bech32/hex normalisers in signer.ts agree: surrounding
    // whitespace is stripped and the decoded identifier matches the clean
    // value, restoring the consistency the bug report flagged as missing.
    await expect(nsecSigner(`  ${nsec}  `).getPublicKey()).resolves.toBe(pubkey)
    expect(toPubkey(`  ${npub}  `)).toBe(pubkey)
  })
})
