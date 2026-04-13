import type { NostrSigner } from '@nostrify/nostrify'
import { NSecSigner, NBrowserSigner } from '@nostrify/nostrify'
import { hexToBytes, bytesToHex } from 'nostr-tools/utils'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { privateKeyToHex, validatePrivateKey, parseBunkerUrl } from '@/lib/nostr'
import type { BunkerSigner } from 'nostr-tools/nip46'

export const DEFAULT_NOSTR_CONNECT_RELAYS = [
  'wss://relay.nsec.app',
  'wss://relay.damus.io',
]

/**
 * Creates a NostrSigner from a private key (nsec or 64-char hex).
 * The key stays in memory only — never sent to the server.
 */
export function createNsecSigner(key: string): NostrSigner {
  if (!validatePrivateKey(key)) {
    throw new Error('Invalid private key — enter an nsec or 64-char hex key')
  }
  const hex = privateKeyToHex(key)
  const secretKey = hexToBytes(hex)
  return new NSecSigner(secretKey)
}

/**
 * Creates a NostrSigner from the browser's NIP-07 extension (window.nostr).
 * Works with Alby, nos2x, and other Nostr browser extensions.
 */
export function createBrowserSigner(): NostrSigner {
  if (typeof window === 'undefined' || !window.nostr) {
    throw new Error('No Nostr browser extension detected')
  }
  return new NBrowserSigner()
}

/**
 * Creates a NostrSigner from a bunker:// URL (NIP-46 remote signing).
 * This establishes a relay connection to the remote signer.
 */
export async function createBunkerSigner(
  bunkerUrl: string,
  opts?: { timeout?: number }
): Promise<NostrSigner> {
  const { BunkerSigner } = await import('nostr-tools/nip46')

  const { remoteUserPubkey, relays, secret } = parseBunkerUrl(bunkerUrl)
  const clientSecretKey = generateSecretKey()

  const bunker = BunkerSigner.fromBunker(clientSecretKey, {
    pubkey: remoteUserPubkey,
    relays,
    secret: secret ?? null,
  })

  // Connect with timeout
  const timeoutMs = opts?.timeout ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await Promise.race([
      bunker.connect(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`Bunker connection timed out after ${timeoutMs / 1000}s`))
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }

  return wrapBunkerSigner(bunker)
}

/**
 * Creates a NostrSigner via nostrconnect:// URI (NIP-46 reverse flow).
 * Generates a URI for display as QR code, then waits for the remote signer to connect.
 */
export async function createNostrConnectSigner(opts: {
  relays?: string[]
  appName?: string
  timeout?: number
  onURI?: (uri: string) => void
  signal?: AbortSignal
}): Promise<NostrSigner> {
  const { BunkerSigner: BS, createNostrConnectURI } = await import('nostr-tools/nip46')

  const clientSecretKey = generateSecretKey()
  const clientPubkey = getPublicKey(clientSecretKey)
  const secret = bytesToHex(generateSecretKey()).slice(0, 16)
  const relays = opts.relays ?? DEFAULT_NOSTR_CONNECT_RELAYS

  const uri = createNostrConnectURI({
    clientPubkey,
    relays,
    secret,
    name: opts.appName ?? 'LaWallet',
  })

  opts.onURI?.(uri)

  const maxWaitOrAbort = opts.signal ?? opts.timeout ?? 60_000
  const bunker = await BS.fromURI(clientSecretKey, uri, {}, maxWaitOrAbort)

  return wrapBunkerSigner(bunker)
}

/** Wraps nostr-tools BunkerSigner to satisfy @nostrify NostrSigner interface */
function wrapBunkerSigner(bunker: BunkerSigner): NostrSigner {
  return {
    getPublicKey: () => bunker.getPublicKey(),
    signEvent: (event) => bunker.signEvent(event),
    nip04: {
      encrypt: (pubkey, plaintext) => bunker.nip04Encrypt(pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => bunker.nip04Decrypt(pubkey, ciphertext),
    },
    nip44: {
      encrypt: (pubkey, plaintext) => bunker.nip44Encrypt(pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => bunker.nip44Decrypt(pubkey, ciphertext),
    },
  } satisfies NostrSigner
}

/**
 * Checks if a NIP-07 browser extension is available.
 */
export function hasBrowserExtension(): boolean {
  return typeof window !== 'undefined' && !!window.nostr
}
