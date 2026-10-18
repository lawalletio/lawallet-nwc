'use client'

export type NwcErrorKind = 'relayOffline' | 'timeout'

/**
 * Classifies raw `@getalby/sdk` / nostr relay-pool errors. The SDK rejects
 * NIP-47 requests with low-level strings ("failed to publish: AggregateError:
 * All promises were rejected", "failed to connect to any relay", "Failed to
 * request …") that mean the wallet's relay couldn't be reached or didn't
 * answer — useless to a user, so the wallet shows localized copy per kind.
 *
 * Returns `null` for anything we don't recognise so genuine wallet-level
 * errors (e.g. "insufficient balance") still surface verbatim.
 */
export function nwcErrorKind(err: unknown): NwcErrorKind | null {
  const msg = (
    err instanceof Error ? err.message : String(err ?? '')
  ).toLowerCase()

  // Relay unreachable — publish to every relay failed, or the pool gave up.
  if (
    msg.includes('failed to publish') ||
    msg.includes('all promises were rejected') ||
    msg.includes('failed to connect to any relay') ||
    msg.includes('connection to relay')
  ) {
    return 'relayOffline'
  }

  // Request reached a relay but the wallet never answered in time.
  if (
    msg.includes('failed to request') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  ) {
    return 'timeout'
  }

  return null
}
