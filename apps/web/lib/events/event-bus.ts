import { Permission } from '@/lib/auth/permissions'
import type { SSEEvent, SSEEventType } from '@/lib/events/event-types'

// Re-export shared types so existing imports continue to work
export type { SSEEvent, SSEEventType }

/** A connected SSE subscriber. The bus filters events by `permissions`. */
export interface SSEClient {
  id: string
  controller: ReadableStreamDefaultController
  permissions: Permission[]
  connectedAt: number
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
   * Broadcasts an event to every subscriber whose permissions allow it.
   * Subscribers that throw on `enqueue` (typically because they disconnected)
   * are silently removed.
   */
  emit(event: SSEEvent): void {
    const requiredPermission = EVENT_PERMISSION_MAP[event.type]
    const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    const encoded = new TextEncoder().encode(sseData)

    const toRemove: string[] = []

    for (const [id, client] of this.clients) {
      // Check permission — null means any authenticated user
      if (requiredPermission && !client.permissions.includes(requiredPermission)) {
        continue
      }

      try {
        client.controller.enqueue(encoded)
      } catch {
        // Client disconnected — mark for removal
        toRemove.push(id)
      }
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
