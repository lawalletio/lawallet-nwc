import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type EventTemplate,
  type NostrEvent
} from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { hexToBytes } from 'nostr-tools/utils'

export type { EventTemplate, NostrEvent }

/**
 * Minimal structural signer interface — everything the SDK needs to
 * authenticate is the ability to sign a Nostr event with the user's key.
 *
 * Structurally compatible with `window.nostr` (NIP-07), @nostrify/nostrify
 * signers, NDK signers and nostr-tools' NIP-46 `BunkerSigner`, so any of them
 * can be passed to `LaWalletClient` directly.
 */
export interface NostrSigner {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<NostrEvent>
}

/** The `window.nostr` object injected by NIP-07 browser extensions. */
interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<NostrEvent>
}

function nip07(): Nip07Provider | undefined {
  return typeof window !== 'undefined'
    ? (window as Window & { nostr?: Nip07Provider }).nostr
    : undefined
}

/** Whether a NIP-07 browser extension (`window.nostr`) is present. */
export function hasBrowserExtension(): boolean {
  return Boolean(nip07())
}

/**
 * Signer backed by a local secret key — an `nsec1…` string or 64-char hex.
 * Signing is silent (no prompts), which makes per-request NIP-98 free.
 */
export function nsecSigner(nsecOrHex: string): NostrSigner {
  let secretKey: Uint8Array
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = nip19.decode(nsecOrHex)
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec')
    }
    secretKey = decoded.data
  } else if (/^[0-9a-f]{64}$/i.test(nsecOrHex)) {
    secretKey = hexToBytes(nsecOrHex.toLowerCase())
  } else {
    throw new Error('Expected an nsec1… string or a 64-character hex key')
  }

  return {
    getPublicKey: async () => getPublicKey(secretKey),
    signEvent: async event => finalizeEvent(event, secretKey)
  }
}

/**
 * Signer backed by a NIP-07 browser extension (`window.nostr`).
 * Throws immediately when no extension is installed so callers can fall back.
 * The provider is re-read on every call — extensions inject asynchronously.
 */
export function browserSigner(): NostrSigner {
  if (!hasBrowserExtension()) {
    throw new Error('No NIP-07 browser extension found (window.nostr)')
  }

  const provider = () => {
    const p = nip07()
    if (!p) throw new Error('NIP-07 extension is no longer available')
    return p
  }

  return {
    getPublicKey: () => provider().getPublicKey(),
    signEvent: event => provider().signEvent(event)
  }
}

export interface GeneratedSigner {
  signer: NostrSigner
  /** Bech32 secret key — show it to the user ONCE for backup, never store it yourself. */
  nsec: string
  npub: string
  pubkey: string
}

/**
 * Generates a brand-new Nostr identity and returns its signer plus the backup
 * material. Ideal for onboarding flows where the visitor has no key yet.
 */
export function generateSigner(): GeneratedSigner {
  const secretKey = generateSecretKey()
  const pubkey = getPublicKey(secretKey)
  return {
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async event => finalizeEvent(event, secretKey)
    },
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(pubkey),
    pubkey
  }
}

/** Hex pubkey → npub. */
export function toNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey)
}
