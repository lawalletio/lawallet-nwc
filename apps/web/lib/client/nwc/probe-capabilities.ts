'use client'

import { closeNwcClient, getNwcClient } from './nwc-client'

/**
 * Subset of `Nip47GetInfoResponse` we surface to the wallet-creation UI.
 * The full SDK type carries `block_height`, `pubkey`, etc., which the user
 * doesn't need to see — we deliberately project down to what's actionable
 * (the wallet's display name + what it can actually do) so the UI doesn't
 * accidentally become tied to fields the wallet might not publish.
 */
export interface NwcCapabilities {
  /** Wallet's self-reported display name (e.g. "Alby Hub"). */
  alias: string | null
  /** Raw NIP-47 methods reported by the wallet. */
  methods: string[]
  /** True iff the wallet supports `make_invoice` — i.e. can RECEIVE. */
  canReceive: boolean
  /** True iff the wallet supports `pay_invoice` — i.e. can SEND. */
  canSend: boolean
  /**
   * Derived `RemoteWallet.config.mode` for this connection. We map onto the
   * platform's two-value enum:
   *   - `SEND_RECEIVE` when the wallet exposes `pay_invoice` (sending is
   *     the strictly more powerful capability; receive support is implied
   *     by every wallet we'd accept here).
   *   - `RECEIVE` otherwise.
   * A receive-less wallet is exceptionally rare in NWC land — surface it
   * to the caller via `canReceive=false` so the UI can flag it.
   */
  mode: 'RECEIVE' | 'SEND_RECEIVE'
}

const DEFAULT_TIMEOUT_MS = 8_000

class TimeoutError extends Error {
  constructor() {
    super('NWC get_info timed out')
    this.name = 'TimeoutError'
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      v => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(v)
      },
      e => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/**
 * Open the NWC connection just long enough to call `get_info`, then derive
 * which capabilities the wallet advertises. Used by the Add Wallet dialog
 * to auto-detect `mode` so the user doesn't have to mentally cross-check
 * the scopes they ticked when they generated the pairing URI.
 *
 * Closes the connection on the way out (success or failure) — this is a
 * one-shot probe, the production payment flow opens its own cached client
 * via `getNwcClient` when it's actually time to move money.
 *
 * @param nwcString - the `nostr+walletconnect://` URI to probe.
 * @param options.signal - optional `AbortSignal` so an in-flight probe can
 *   be cancelled (e.g. the user keeps typing).
 * @param options.timeoutMs - cap on the get_info round-trip. Defaults to
 *   8 seconds — relays can be slow but waiting longer makes the dialog
 *   feel broken.
 * @throws when the URI is malformed, the relay never replies, or the
 *   wallet returns an error. Callers should treat the throw as "couldn't
 *   detect" and let the user submit anyway with a fallback `mode`.
 */
export async function probeNwcCapabilities(
  nwcString: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<NwcCapabilities> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options

  // Defer the relay handshake to the SDK; `getNwcClient` already memoises
  // per-URI, so back-to-back probes of the same URI are cheap.
  const client = await getNwcClient(nwcString)
  try {
    const info = await withTimeout(client.getInfo(), timeoutMs, signal)
    const methods = Array.isArray(info.methods) ? info.methods.map(String) : []
    const canReceive = methods.includes('make_invoice')
    const canSend = methods.includes('pay_invoice')
    return {
      alias: typeof info.alias === 'string' && info.alias.length > 0 ? info.alias : null,
      methods,
      canReceive,
      canSend,
      mode: canSend ? 'SEND_RECEIVE' : 'RECEIVE',
    }
  } finally {
    // Probing creates a relay subscription that the user is unlikely to
    // need again until they actually submit the form (and even then, the
    // server side opens its own connection). Closing the client here
    // keeps the dialog from leaving a dangling websocket open while the
    // user fiddles with the rest of the form.
    closeNwcClient(nwcString)
  }
}
