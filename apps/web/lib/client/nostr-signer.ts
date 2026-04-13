import type { NostrSigner } from '@nostrify/nostrify'
import { NSecSigner, NBrowserSigner } from '@nostrify/nostrify'
import { hexToBytes, bytesToHex } from 'nostr-tools/utils'
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { privateKeyToHex, validatePrivateKey, parseBunkerUrl } from '@/lib/nostr'

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
  const { remoteUserPubkey, relays, secret } = parseBunkerUrl(bunkerUrl)
  const clientSecretKey = generateSecretKey()

  const signer = new Nip46Signer(clientSecretKey, {
    pubkey: remoteUserPubkey,
    relays,
    secret: secret ?? undefined,
  })

  const timeoutMs = opts?.timeout ?? 30_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    await Promise.race([
      signer.connect(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`Bunker connection timed out after ${timeoutMs / 1000}s`))
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }

  return wrapNip46Signer(signer)
}

/**
 * Creates a NostrSigner via nostrconnect:// URI (NIP-46 reverse flow).
 * Generates a URI for display as QR code, then waits for the remote signer to connect.
 *
 * Supports both NIP-44 and NIP-04 encryption for the initial handshake,
 * since some signers (nsec.app, Amber) may use NIP-04.
 */
export async function createNostrConnectSigner(opts: {
  relays?: string[]
  appName?: string
  timeout?: number
  onURI?: (uri: string) => void
  signal?: AbortSignal
}): Promise<NostrSigner> {
  const { createNostrConnectURI } = await import('nostr-tools/nip46')

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

  const signer = await Nip46Signer.fromURI(clientSecretKey, uri, {
    timeout: opts.timeout ?? 60_000,
    signal: opts.signal,
  })

  return wrapNip46Signer(signer)
}

/** Wraps our Nip46Signer to satisfy @nostrify NostrSigner interface */
function wrapNip46Signer(signer: Nip46Signer): NostrSigner {
  return {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (event) => signer.signEvent(event),
    nip04: {
      encrypt: (pubkey, plaintext) => signer.sendRequest('nip04_encrypt', [pubkey, plaintext]),
      decrypt: (pubkey, ciphertext) => signer.sendRequest('nip04_decrypt', [pubkey, ciphertext]),
    },
    nip44: {
      encrypt: (pubkey, plaintext) => signer.sendRequest('nip44_encrypt', [pubkey, plaintext]),
      decrypt: (pubkey, ciphertext) => signer.sendRequest('nip44_decrypt', [pubkey, ciphertext]),
    },
  } satisfies NostrSigner
}

/**
 * Checks if a NIP-07 browser extension is available.
 */
export function hasBrowserExtension(): boolean {
  return typeof window !== 'undefined' && !!window.nostr
}

// ─── NIP-46 Signer with NIP-04/NIP-44 dual encryption support ────────────

const NOSTR_CONNECT_KIND = 24133

type EncryptionVersion = 'nip44' | 'nip04'

interface BunkerParams {
  pubkey: string
  relays: string[]
  secret?: string
}

/**
 * Custom NIP-46 remote signer that supports both NIP-44 and NIP-04 encryption.
 *
 * nostr-tools' BunkerSigner only supports NIP-44, but some signers (nsec.app,
 * Amber) send the initial connection response encrypted with NIP-04, causing
 * "invalid payload length" errors. This implementation auto-detects the
 * encryption version and uses it consistently for the session.
 */
class Nip46Signer {
  private pool!: InstanceType<typeof import('nostr-tools').SimplePool>
  private subCloser?: { close: () => void }
  private listeners: Record<string, { resolve: (v: string) => void; reject: (e: unknown) => void }> = {}
  private serial = 0
  private idPrefix = Math.random().toString(36).substring(7)
  private isOpen = false
  private cachedPubKey?: string
  private encryptionVersion: EncryptionVersion = 'nip44'

  constructor(
    private secretKey: Uint8Array,
    private bp: BunkerParams
  ) {}

  private async ensurePool() {
    if (!this.pool) {
      const { SimplePool } = await import('nostr-tools')
      this.pool = new SimplePool()
    }
  }

  /**
   * Try to decrypt content using NIP-44 first, then fall back to NIP-04.
   * Returns the decrypted string and which version succeeded.
   */
  private async tryDecrypt(
    content: string,
    peerPubkey: string
  ): Promise<{ plaintext: string; version: EncryptionVersion }> {
    // Try NIP-44 first
    try {
      const nip44 = await import('nostr-tools/nip44')
      const convKey = nip44.v2.utils.getConversationKey(this.secretKey, peerPubkey)
      const plaintext = nip44.v2.decrypt(content, convKey)
      return { plaintext, version: 'nip44' }
    } catch {
      // NIP-44 failed, try NIP-04
    }

    try {
      const nip04 = await import('nostr-tools/nip04')
      const plaintext = await nip04.decrypt(this.secretKey, peerPubkey, content)
      return { plaintext, version: 'nip04' }
    } catch {
      throw new Error('Failed to decrypt NIP-46 response with both NIP-44 and NIP-04')
    }
  }

  /** Encrypt content using the detected encryption version */
  private async encryptContent(plaintext: string, peerPubkey: string): Promise<string> {
    if (this.encryptionVersion === 'nip44') {
      const nip44 = await import('nostr-tools/nip44')
      const convKey = nip44.v2.utils.getConversationKey(this.secretKey, peerPubkey)
      return nip44.v2.encrypt(plaintext, convKey)
    } else {
      const nip04 = await import('nostr-tools/nip04')
      return nip04.encrypt(this.secretKey, peerPubkey, plaintext)
    }
  }

  /** Set up subscription to receive responses from the remote signer */
  private async setupSubscription() {
    await this.ensurePool()
    const clientPubkey = getPublicKey(this.secretKey)

    this.subCloser = this.pool.subscribe(
      this.bp.relays,
      {
        kinds: [NOSTR_CONNECT_KIND],
        authors: [this.bp.pubkey],
        '#p': [clientPubkey],
        limit: 0,
      },
      {
        onevent: async event => {
          try {
            const { plaintext } = await this.tryDecrypt(event.content, event.pubkey)
            const { id, result, error } = JSON.parse(plaintext)
            const handler = this.listeners[id]
            if (handler) {
              if (error) handler.reject(error)
              else if (result) handler.resolve(result)
              delete this.listeners[id]
            }
          } catch (e) {
            console.warn('[nip46] failed to process event', e)
          }
        },
        onclose: () => {
          this.subCloser = undefined
        },
      }
    )
    this.isOpen = true
  }

  /** Wait for the initial connection from a nostrconnect:// URI flow */
  static async fromURI(
    clientSecretKey: Uint8Array,
    connectionURI: string,
    opts: { timeout?: number; signal?: AbortSignal }
  ): Promise<Nip46Signer> {
    const signer = new Nip46Signer(clientSecretKey, { pubkey: '', relays: [] })
    await signer.ensurePool()

    const uri = new URL(connectionURI)
    const clientPubkey = getPublicKey(clientSecretKey)
    const expectedSecret = uri.searchParams.get('secret')
    const relays = uri.searchParams.getAll('relay')

    return new Promise<Nip46Signer>((resolve, reject) => {
      let settled = false

      const sub = signer.pool.subscribe(
        relays,
        {
          kinds: [NOSTR_CONNECT_KIND],
          '#p': [clientPubkey],
          limit: 0,
        },
        {
          onevent: async event => {
            if (settled) return
            try {
              const { plaintext, version } = await signer.tryDecrypt(
                event.content,
                event.pubkey
              )
              const response = JSON.parse(plaintext)

              if (response.result === expectedSecret) {
                settled = true
                sub.close()

                // Configure the signer with the detected encryption version
                signer.bp = { pubkey: event.pubkey, relays, secret: expectedSecret ?? undefined }
                signer.encryptionVersion = version
                await signer.setupSubscription()
                resolve(signer)
              }
            } catch (e) {
              console.warn('[nip46] failed to process potential connection event', e)
            }
          },
          onclose: () => {
            if (!settled) reject(new Error('Subscription closed before connection was established'))
          },
        }
      )

      // Handle timeout / abort
      const timeoutMs = opts.timeout ?? 60_000
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          if (!settled) { settled = true; sub.close(); reject(new Error('Connection aborted')) }
        })
      } else {
        setTimeout(() => {
          if (!settled) { settled = true; sub.close(); reject(new Error('Connection timed out')) }
        }, timeoutMs)
      }
    })
  }

  /** Send a connect request (for bunker:// flow) */
  async connect(): Promise<void> {
    await this.setupSubscription()
    await this.sendRequest('connect', [this.bp.pubkey, this.bp.secret || ''])
  }

  /** Send an RPC request to the remote signer */
  async sendRequest(method: string, params: string[]): Promise<string> {
    if (!this.isOpen) throw new Error('Signer is not connected')
    if (!this.subCloser) await this.setupSubscription()

    this.serial++
    const id = `${this.idPrefix}-${this.serial}`
    const encryptedContent = await this.encryptContent(
      JSON.stringify({ id, method, params }),
      this.bp.pubkey
    )

    const event = finalizeEvent(
      {
        kind: NOSTR_CONNECT_KIND,
        tags: [['p', this.bp.pubkey]],
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
      },
      this.secretKey
    )

    return new Promise<string>((resolve, reject) => {
      this.listeners[id] = { resolve, reject }
      Promise.any(this.pool.publish(this.bp.relays, event)).catch(reject)
    })
  }

  async getPublicKey(): Promise<string> {
    if (!this.cachedPubKey) {
      this.cachedPubKey = await this.sendRequest('get_public_key', [])
    }
    return this.cachedPubKey
  }

  async signEvent(event: Parameters<NostrSigner['signEvent']>[0]) {
    const resp = await this.sendRequest('sign_event', [JSON.stringify(event)])
    const signed = JSON.parse(resp)
    if (verifyEvent(signed)) return signed
    throw new Error('Event returned from bunker is improperly signed')
  }

  async close() {
    this.isOpen = false
    this.subCloser?.close()
  }
}
