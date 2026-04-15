/**
 * Shared SSE event type definitions. Kept in a client-safe module (no server
 * imports) so both `lib/events/event-bus.ts` (server) and
 * `lib/client/hooks/use-sse.ts` (client) can share the same source of truth.
 */

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

export const ALL_SSE_EVENT_TYPES: readonly SSEEventType[] = [
  'addresses:updated',
  'cards:updated',
  'designs:updated',
  'settings:updated',
  'invoices:updated',
  'users:updated',
] as const
