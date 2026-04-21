import type { Event, Filter } from 'nostr-tools'
import type { RelayPool } from './pool.js'

export type WalletInfo = {
  found: boolean
  eventId: string | null
  createdAt: number | null
  supportedMethods: string[]
  notifications: string[]
  encryption: string[]
  raw: Event | null
}

/**
 * Fetches the wallet's NIP-47 info event (kind 13194, replaceable).
 * Tells you exactly what commands and notification kinds the wallet service
 * advertises — the single most useful diagnostic when a NWC connection is
 * not receiving notifications.
 *
 *   content:  space-separated list of supported methods
 *             e.g. "pay_invoice make_invoice lookup_invoice list_transactions"
 *   tags:     [["notifications", "payment_received", "payment_sent"], ...]
 *             [["encryption", "nip44_v2", "nip04"]]
 */
export async function fetchWalletInfo(
  pool: RelayPool,
  walletPubkey: string,
  relays: string[],
  timeoutMs = 4000
): Promise<WalletInfo> {
  const filter: Filter = {
    kinds: [13194],
    authors: [walletPubkey],
    limit: 1
  }

  const event = await pool.fetchOne(relays, filter, timeoutMs)
  if (!event) {
    return {
      found: false,
      eventId: null,
      createdAt: null,
      supportedMethods: [],
      notifications: [],
      encryption: [],
      raw: null
    }
  }

  const supportedMethods = event.content
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)

  const notifications =
    event.tags.find(t => t[0] === 'notifications')?.slice(1) ?? []
  const encryption =
    event.tags.find(t => t[0] === 'encryption')?.slice(1) ?? []

  return {
    found: true,
    eventId: event.id,
    createdAt: event.created_at,
    supportedMethods,
    notifications,
    encryption,
    raw: event
  }
}
