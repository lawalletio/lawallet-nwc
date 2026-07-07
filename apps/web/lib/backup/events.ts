import { eventBus } from '@/lib/events/event-bus'
import type { SSEEventType } from '@/lib/events/event-types'
import type { BackupImportResult, BackupTableName } from '@/lib/validation/schemas'

/**
 * Maps a restored table to the existing SSE event that refreshes the admin
 * surfaces reading it. Tables with no matching event (remote wallets, alby,
 * activity logs, caches, plugins) are refetched on demand by their pages —
 * we deliberately don't invent new SSE types (the permission map is total).
 */
const TABLE_EVENTS: Partial<Record<BackupTableName, SSEEventType>> = {
  users: 'users:updated',
  lightningAddresses: 'addresses:updated',
  cards: 'cards:updated',
  ntag424s: 'cards:updated',
  cardActivationTokens: 'cards:updated',
  cardDesigns: 'designs:updated',
  settings: 'settings:updated',
  invoices: 'invoices:updated',
}

/** Broadcasts one refresh event per touched table type after a restore. */
export function emitRestoreEvents(result: BackupImportResult): void {
  const events = new Set<SSEEventType>()
  for (const [table, tableResult] of Object.entries(result.tables)) {
    if (!tableResult) continue
    const touched =
      tableResult.imported + tableResult.overwritten + tableResult.renamed + tableResult.deleted
    if (touched <= 0) continue
    const event = TABLE_EVENTS[table as BackupTableName]
    if (event) events.add(event)
  }
  const timestamp = Date.now()
  for (const type of events) {
    try {
      eventBus.emit({ type, timestamp })
    } catch {
      // Best-effort; a broken SSE client must not fail the import response.
    }
  }
}
