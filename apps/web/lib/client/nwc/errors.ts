'use client'

/**
 * Maps raw `@getalby/sdk` / nostr relay-pool errors to a short, actionable
 * message for wallet users. The SDK rejects NIP-47 requests with low-level
 * strings ("failed to publish: AggregateError: All promises were rejected",
 * "failed to connect to any relay", "Failed to request …") that mean the
 * wallet's relay couldn't be reached or didn't answer — useless to a user.
 *
 * Returns the original message for anything we don't recognise so genuine
 * wallet-level errors (e.g. "insufficient balance") still surface verbatim.
 */
export function describeNwcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const msg = raw.toLowerCase()

  // Relay unreachable — publish to every relay failed, or the pool gave up.
  if (
    msg.includes('failed to publish') ||
    msg.includes('all promises were rejected') ||
    msg.includes('failed to connect to any relay') ||
    msg.includes('connection to relay')
  ) {
    return "Couldn't reach your wallet. Its relay looks offline — check the wallet connection and try again."
  }

  // Request reached a relay but the wallet never answered in time.
  if (msg.includes('failed to request') || msg.includes('timeout') || msg.includes('timed out')) {
    return "Your wallet didn't respond in time. Please try again."
  }

  return raw || 'Something went wrong. Please try again.'
}
