import { describe, it, expect } from 'vitest'
import { NSecSigner } from '@nostrify/nostrify'
import type { NostrSigner } from '@nostrify/nostrify'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { toBlossomSigner } from '@/lib/client/blossom-signer'

// Blossom-specific auth event kind (BUD-01). Matches the value embedded in
// `createUploadAuth` calls; we use the literal here so the test isn't coupled
// to the SDK's internal const.
const AUTH_EVENT_KIND = 24242

/**
 * Build a fake NIP-07 extension signer. `NBrowserSigner` proxies
 * `window.nostr`, which in turn is the shape below. We build this directly
 * rather than instantiating `NBrowserSigner` because that class requires
 * `globalThis.nostr` and we want the test to be hermetic.
 */
function makeNip07Stub(secretKey: Uint8Array): NostrSigner {
  return {
    getPublicKey: async () => getPublicKey(secretKey),
    signEvent: async event => finalizeEvent(event, secretKey),
  }
}

/**
 * Build a fake NIP-46 bunker signer. In production the `wrapNip46Signer`
 * helper in `nostr-signer.ts` returns an object of this shape after talking
 * to the remote signer over relays; for tests we short-circuit the relay
 * round-trip and sign locally. The important invariant is that
 * `signEvent(template) → full NostrEvent with id/pubkey/sig`, matching
 * what the real bunker returns.
 */
function makeBunkerStub(secretKey: Uint8Array): NostrSigner {
  return {
    getPublicKey: async () => getPublicKey(secretKey),
    signEvent: async event => finalizeEvent(event, secretKey),
  }
}

describe('toBlossomSigner', () => {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)

  // nostr-tools' `finalizeEvent` mutates its input by attaching id/pubkey/sig,
  // so each test must build a fresh draft to avoid cross-test contamination.
  function makeDraft() {
    const created_at = Math.floor(Date.now() / 1000)
    return {
      kind: AUTH_EVENT_KIND,
      content: 'Upload test.png',
      created_at,
      tags: [
        ['t', 'upload'],
        ['x', '0'.repeat(64)],
        ['expiration', String(created_at + 3600)],
      ],
    }
  }

  it('wraps an NSecSigner (local nsec) into a valid blossom Signer', async () => {
    const draft = makeDraft()
    const signer = toBlossomSigner(new NSecSigner(sk))
    const event = await signer(draft)

    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(event.pubkey).toBe(pk)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(event.kind).toBe(AUTH_EVENT_KIND)
    expect(event.content).toBe(draft.content)
    expect(verifyEvent(event)).toBe(true)
  })

  it('wraps a NIP-07 browser-extension-shaped signer identically', async () => {
    const draft = makeDraft()
    const signer = toBlossomSigner(makeNip07Stub(sk))
    const event = await signer(draft)

    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(event.pubkey).toBe(pk)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifyEvent(event)).toBe(true)
  })

  it('wraps a NIP-46 bunker-shaped signer identically', async () => {
    const draft = makeDraft()
    const signer = toBlossomSigner(makeBunkerStub(sk))
    const event = await signer(draft)

    expect(event.id).toMatch(/^[0-9a-f]{64}$/)
    expect(event.pubkey).toBe(pk)
    expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
    expect(verifyEvent(event)).toBe(true)
  })

  it('produces structurally identical output for all three signer types', async () => {
    // Same secret key + same template → same event id and pubkey for every
    // wrap, proving the adapter doesn't smuggle in per-signer behaviour.
    // BIP-340 Schnorr signatures are non-deterministic (fresh nonce per
    // invocation), so we don't compare `sig` — we just verify each signature
    // independently.
    //
    // Each wrap gets its own fresh draft because `finalizeEvent` mutates.
    // We pin `created_at` so the id-derivation input is identical across all
    // three drafts (otherwise a sub-second tick between Date.now() calls
    // would change the ids).
    const pinned = 1_700_000_000
    const drafts = [0, 1, 2].map(() => ({ ...makeDraft(), created_at: pinned }))

    const nsec = toBlossomSigner(new NSecSigner(sk))
    const nip07 = toBlossomSigner(makeNip07Stub(sk))
    const bunker = toBlossomSigner(makeBunkerStub(sk))

    const [a, b, c] = await Promise.all([nsec(drafts[0]), nip07(drafts[1]), bunker(drafts[2])])

    expect(a.id).toBe(b.id)
    expect(b.id).toBe(c.id)
    expect(a.pubkey).toBe(b.pubkey)
    expect(b.pubkey).toBe(c.pubkey)
    expect(verifyEvent(a)).toBe(true)
    expect(verifyEvent(b)).toBe(true)
    expect(verifyEvent(c)).toBe(true)
  })

  it('rejects when the underlying signer returns a malformed event', async () => {
    const broken: NostrSigner = {
      getPublicKey: async () => pk,
      // @ts-expect-error intentionally returning the wrong shape
      signEvent: async event => ({ ...event }),
    }
    const signer = toBlossomSigner(broken)
    await expect(signer(makeDraft())).rejects.toThrow(/unsigned or malformed/i)
  })

  it('rejects when the underlying signer returns a non-object', async () => {
    const broken: NostrSigner = {
      getPublicKey: async () => pk,
      // @ts-expect-error intentionally wrong return
      signEvent: async () => null,
    }
    const signer = toBlossomSigner(broken)
    await expect(signer(makeDraft())).rejects.toThrow(/unsigned or malformed/i)
  })

  it('propagates errors thrown by the underlying signer', async () => {
    const rejecting: NostrSigner = {
      getPublicKey: async () => pk,
      signEvent: async () => {
        throw new Error('user denied signing')
      },
    }
    const signer = toBlossomSigner(rejecting)
    await expect(signer(makeDraft())).rejects.toThrow(/user denied/i)
  })
})
