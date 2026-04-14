import { Permission } from '@/lib/auth/permissions'

// ─── Types ────────────────────────────────────────────────────────────────

export type SSEEventType =
  | 'addresses:updated'
  | 'cards:updated'
  | 'designs:updated'
  | 'settings:updated'
  | 'invoices:updated'
  | 'users:updated'

export interface SSEEvent {
  type: SSEEventType
  timestamp: number
}

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
}

// ─── Event Bus ────────────────────────────────────────────────────────────

class EventBus {
  private clients: Map<string, SSEClient> = new Map()

  addClient(client: SSEClient): void {
    this.clients.set(client.id, client)
  }

  removeClient(id: string): void {
    this.clients.delete(id)
  }

  getClientCount(): number {
    return this.clients.size
  }

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

export const eventBus = globalForEventBus.eventBus ?? new EventBus()

if (process.env.NODE_ENV !== 'production') {
  globalForEventBus.eventBus = eventBus
}
