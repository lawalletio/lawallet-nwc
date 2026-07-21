import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    isDevelopment: false,
    isTest: true,
  })),
}))

import {
  mintNostrLinkChallenge,
  verifyNostrLinkProof,
  mintMergeTicket,
  verifyMergeTicket,
  LINK_PROOF_EVENT_KIND,
} from '@/lib/account/proof'
import { AuthenticationError, ValidationError } from '@/types/server/errors'

const ACCOUNT = 'account-1'

function signProof(nonce: string, overrides?: Partial<{ kind: number; created_at: number; tags: string[][] }>) {
  const sk = generateSecretKey()
  const event = finalizeEvent(
    {
      kind: overrides?.kind ?? LINK_PROOF_EVENT_KIND,
      created_at: overrides?.created_at ?? Math.floor(Date.now() / 1000),
      tags: overrides?.tags ?? [['challenge', nonce]],
      content: '',
    },
    sk
  )
  return { event, pubkey: getPublicKey(sk) }
}

describe('nostr link proof', () => {
  beforeEach(() => vi.clearAllMocks())

  it('round-trips: mint → sign → verify returns the proven pubkey', () => {
    const { challenge, nonce } = mintNostrLinkChallenge(ACCOUNT)
    const { event, pubkey } = signProof(nonce)

    expect(
      verifyNostrLinkProof({ challenge, event, accountId: ACCOUNT })
    ).toBe(pubkey)
  })

  it('rejects a challenge bound to a different account', () => {
    const { challenge, nonce } = mintNostrLinkChallenge('someone-else')
    const { event } = signProof(nonce)
    expect(() =>
      verifyNostrLinkProof({ challenge, event, accountId: ACCOUNT })
    ).toThrow(AuthenticationError)
  })

  it('rejects a proof answering a different nonce', () => {
    const { challenge } = mintNostrLinkChallenge(ACCOUNT)
    const { event } = signProof('wrong-nonce')
    expect(() =>
      verifyNostrLinkProof({ challenge, event, accountId: ACCOUNT })
    ).toThrow(AuthenticationError)
  })

  it('rejects the wrong event kind', () => {
    const { challenge, nonce } = mintNostrLinkChallenge(ACCOUNT)
    const { event } = signProof(nonce, { kind: 1 })
    expect(() =>
      verifyNostrLinkProof({ challenge, event, accountId: ACCOUNT })
    ).toThrow(ValidationError)
  })

  it('rejects a stale proof event', () => {
    const { challenge, nonce } = mintNostrLinkChallenge(ACCOUNT)
    const { event } = signProof(nonce, {
      created_at: Math.floor(Date.now() / 1000) - 3600,
    })
    expect(() =>
      verifyNostrLinkProof({ challenge, event, accountId: ACCOUNT })
    ).toThrow(AuthenticationError)
  })

  it('rejects a tampered signature', () => {
    const { challenge, nonce } = mintNostrLinkChallenge(ACCOUNT)
    const { event } = signProof(nonce)
    // JSON round-trip strips nostr-tools' verifiedSymbol cache — matching how
    // a real request body arrives — so verifyEvent actually re-verifies.
    const tampered = { ...JSON.parse(JSON.stringify(event)), content: 'evil' }
    expect(() =>
      verifyNostrLinkProof({ challenge, event: tampered, accountId: ACCOUNT })
    ).toThrow(AuthenticationError)
  })

  it('rejects a garbage challenge token', () => {
    const { event } = signProof('n')
    expect(() =>
      verifyNostrLinkProof({ challenge: 'not-a-jwt', event, accountId: ACCOUNT })
    ).toThrow(AuthenticationError)
  })
})

describe('merge ticket', () => {
  it('round-trips and binds to the survivor', () => {
    const ticket = mintMergeTicket({
      survivorId: ACCOUNT,
      absorbedId: 'account-2',
      provenPubkey: 'f'.repeat(64),
    })
    expect(verifyMergeTicket(ticket, ACCOUNT)).toEqual({
      survivorId: ACCOUNT,
      absorbedId: 'account-2',
      provenPubkey: 'f'.repeat(64),
    })
  })

  it('rejects a ticket presented by a different account', () => {
    const ticket = mintMergeTicket({
      survivorId: 'other',
      absorbedId: 'account-2',
      provenPubkey: 'f'.repeat(64),
    })
    expect(() => verifyMergeTicket(ticket, ACCOUNT)).toThrow(AuthenticationError)
  })

  it('rejects a link challenge passed as a merge ticket (kind confusion)', () => {
    const { challenge } = mintNostrLinkChallenge(ACCOUNT)
    expect(() => verifyMergeTicket(challenge, ACCOUNT)).toThrow(AuthenticationError)
  })
})
