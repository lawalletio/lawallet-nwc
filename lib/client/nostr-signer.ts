import type { NostrSigner } from '@nostrify/nostrify'
import { NSecSigner, NBrowserSigner } from '@nostrify/nostrify'
import { hexToBytes } from 'nostr-tools/utils'
import { generateSecretKey } from 'nostr-tools/pure'
import { nsecToHex, validateNsec, parseBunkerUrl } from '@/lib/nostr'

/**
 * Creates a NostrSigner from an nsec private key.
 * The key stays in memory only — never sent to the server.
 */
export function createNsecSigner(nsec: string): NostrSigner {
  if (!validateNsec(nsec)) {
    throw new Error('Invalid nsec format')
  }
  const hex = nsecToHex(nsec)
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

  // Wrap BunkerSigner to satisfy NostrSigner interface from @nostrify/nostrify
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
