import { Permission } from '@/lib/auth/permissions'
import type { SSEEvent, SSEEventType } from '@/lib/events/event-types'

// Re-export shared types so existing imports continue to work
export type { SSEEvent, SSEEventType }

/** A connected SSE subscriber. The bus filters events by `permissions`. */
export interface SSEClient {
  id: string
  controller: ReadableStreamDefaultController
  permissions: Permission[]
  /** Account id, so user-scoped events reach only their owner (+ admins). */
  userId?: string
  connectedAt: number
}

/**
 * How many unread chunks a client may fall behind before it is dropped. The
 * stream's default high-water mark is one chunk, so `desiredSize` goes
 * negative by one per chunk the client hasn't drained. Dropping is safe: the
 * client reconnects and refetches everything.
 */
const MAX_QUEUED_CHUNKS = 32

/**
 * Enqueues `chunk`, or closes the stream when the client is too far behind to
 * keep buffering for it. Returns false when the client should be dropped.
 */
export function trySend(
  controller: ReadableStreamDefaultController,
  chunk: Uint8Array
): boolean {
  try {
    if ((controller.desiredSize ?? 0) <= -MAX_QUEUED_CHUNKS) {
      controller.close()
      return false
    }
    controller.enqueue(chunk)
    return true
  } catch {
    // Already closed or errored — the client is gone.
    return false
  }
}

// ─── Permission mapping ───────────────────────────────────────────────────

const EVENT_PERMISSION_MAP: Record<SSEEventType, Permission | null> = {
  'addresses:updated': Permission.ADDRESSES_READ,
  'cards:updated': Permission.CARDS_READ,
  'designs:updated': Permission.CARD_DESIGNS_READ,
  'settings:updated': Permission.SETTINGS_READ,
  'invoices:updated': null, // any authenticated user (own invoices)
  'users:updated': Permission.USERS_READ,
  'activity:new': Permission.ACTIVITY_READ,
  'listener:updated': Permission.SETTINGS_READ, // infra telemetry, same gate as Settings
  // Payload-free invalidation. APIs remain owner-scoped, so every signed-in
  // user may safely refetch without learning another account's wallet ids.
  'remote-wallet-forwarding:updated': null,
  'remote-wallet-notifications:updated': null,
  'vouchers:updated': null
}

// ─── Event Bus ────────────────────────────────────────────────────────────

/**
 * In-process pub/sub for the SSE endpoint. Singleton — see `eventBus` below.
 * Permission-aware: events only reach clients whose permissions include the
 * required scope from `EVENT_PERMISSION_MAP`.
 */
class EventBus {
  private clients: Map<string, SSEClient> = new Map()

  /** Registers a new SSE subscriber. Idempotent on `client.id`. */
  addClient(client: SSEClient): void {
    this.clients.set(client.id, client)
  }

  /** Drops a subscriber. Safe to call on an unknown id. */
  removeClient(id: string): void {
    this.clients.delete(id)
  }

  /** Number of connected subscribers — used by the diagnostics endpoint. */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Broadcasts an event to every subscriber whose permissions allow it. An
   * event carrying `userId` only reaches that account's clients and admins
   * (who can read any user's wallets). Subscribers that are gone or too far
   * behind are dropped.
   */
  emit(event: SSEEvent): void {
    const requiredPermission = EVENT_PERMISSION_MAP[event.type]
    const { userId, ...payload } = event
    const sseData = `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`
    const encoded = new TextEncoder().encode(sseData)

    const toRemove: string[] = []

    for (const [id, client] of this.clients) {
      // Check permission — null means any authenticated user
      if (
        requiredPermission &&
        !client.permissions.includes(requiredPermission)
      ) {
        continue
      }
      if (
        userId &&
        client.userId !== userId &&
        !client.permissions.includes(Permission.REMOTE_WALLETS_READ)
      ) {
        continue
      }

      if (!trySend(client.controller, encoded)) toRemove.push(id)
    }

    // Clean up disconnected clients
    for (const id of toRemove) {
      this.clients.delete(id)
    }
  }
}

// ─── Singleton (survives HMR, matches lib/prisma.ts pattern) ──────────────

const globalForEventBus = globalThis as unknown as {
  eventBus: EventBus | undefined
}

/** Process-wide SSE broadcast bus. Survives Next.js HMR via `globalThis`. */
export const eventBus = globalForEventBus.eventBus ?? new EventBus()

if (process.env.NODE_ENV !== 'production') {
  globalForEventBus.eventBus = eventBus
}
