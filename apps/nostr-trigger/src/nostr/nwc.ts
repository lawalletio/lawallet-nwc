import { getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { nip19 } from 'nostr-tools'

export type ParsedNwcUri = {
  walletPubkey: string
  clientSecret: string
  relays: string[]
  lud16?: string
}

/**
 * Parses a Nostr Wallet Connect URI.
 *
 * Format per NIP-47:
 *   nostr+walletconnect://<wallet-service-pubkey>?relay=<url>&secret=<hex>&lud16=<addr>
 *
 * Also accepts `nostrwalletconnect://` which is the legacy form emitted by
 * some wallets (notably Alby).
 */
export function parseNwcUri(uri: string): ParsedNwcUri {
  const normalized = uri
    .replace(/^nostr\+walletconnect:\/\//, 'nostrwc://')
    .replace(/^nostrwalletconnect:\/\//, 'nostrwc://')

  if (!normalized.startsWith('nostrwc://')) {
    throw new Error('Not a NWC URI')
  }

  const u = new URL(normalized)
  const walletPubkey = u.hostname || u.pathname.replace(/^\/+/, '')
  const relays = u.searchParams.getAll('relay')
  const secret = u.searchParams.get('secret')
  const lud16 = u.searchParams.get('lud16') ?? undefined

  if (!walletPubkey || !/^[0-9a-f]{64}$/i.test(walletPubkey)) {
    throw new Error('Invalid wallet pubkey in NWC URI')
  }
  if (relays.length === 0) {
    throw new Error('NWC URI missing relay(s)')
  }
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) {
    throw new Error('NWC URI missing valid secret')
  }

  return {
    walletPubkey: walletPubkey.toLowerCase(),
    clientSecret: secret.toLowerCase(),
    relays,
    lud16
  }
}

export function derivePubkey(secretHex: string): string {
  return getPublicKey(hexToBytes(secretHex))
}

export function nsecToHex(nsec: string): string {
  const decoded = nip19.decode(nsec)
  if (decoded.type !== 'nsec') throw new Error('Expected nsec')
  return Buffer.from(decoded.data as Uint8Array).toString('hex')
}

export function normalizeRelayUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}
