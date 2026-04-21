/**
 * In-memory pub/sub for dashboard SSE. Lives only in the current process —
 * the dashboard is a local developer tool, not a cross-instance notification
 * channel. If horizontal scale-out ever arrives, replace with Redis pub/sub.
 */

export type NotificationEvent = {
  type: 'notification'
  nwcConnectionId: string
  eventId: string
  eventKind: number
  relayUrl: string
  createdAt: number
  /** e.g. "payment_received", "payment_sent" — from decrypted payload */
  notificationType: string | null
  /** hex, from the inner notification body */
  paymentHash: string | null
  /** amount in msats (NIP-47 reports msats) */
  amount: number | null
  /** optional memo / description */
  description: string | null
  payload: unknown
  ts: number
}

export type WebhookEvent = {
  type: 'webhook'
  outcome: 'success' | 'retry' | 'terminal' | 'exhausted'
  webhookEndpointId: string
  eventId: string
  reason?: string
  status?: number | null
  ts: number
}

export type ZapEvent = {
  type: 'zap'
  eventId: string
  recipient: string
  relays: string[]
  ts: number
}

export type DashboardEvent = NotificationEvent | WebhookEvent | ZapEvent

type Listener = (e: DashboardEvent) => void

class EventBus {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: DashboardEvent): void {
    for (const l of this.listeners) {
      try {
        l(event)
      } catch {
        // swallow — subscriber bugs must not take the emitter down
      }
    }
  }

  subscriberCount(): number {
    return this.listeners.size
  }
}

export const dashboardBus = new EventBus()
